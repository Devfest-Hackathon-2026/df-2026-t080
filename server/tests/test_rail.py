# OSM の路線から乗換なしの電車の目安を出す仕組み（rail.py）と、/api/bus-table・/api/bus-info への合わせ方の試験。
# Overpass には聞かない（返事は作り物）。cd server && uv run python -m unittest discover -s tests
import json, os, socket, sys, tempfile, threading, time, unittest
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
os.environ['ZT_RAIL'] = '0'
os.environ.setdefault('ZT_LLM_MODULE', os.path.join(HERE, 'fake_llm.py'))
import bus, rail  # noqa: E402

LAT = 34.70
STEP = 0.011                       # 経度 0.011 度 ≒ 1 km


def node(i, name, en='', lat=LAT, k=0):
    tags = {'name': name} if name else {}
    if en:
        tags['name:en'] = en
    return {'type': 'node', 'id': i, 'lat': lat, 'lon': 135.50 + STEP * k, 'tags': tags}


def rel(i, tags, members):
    return {'type': 'relation', 'id': i, 'tags': {'type': 'route', **tags},
            'members': [{'type': 'node', 'ref': r, 'role': role} for r, role in members]}


def answer():
    """地下鉄 1 本（A・B・C・D）、路面電車 1 本（ホームだけ・10 分おき）、外す路線、駅が 1 つの路線"""
    nodes = [node(1, 'A駅', 'A St', k=0), node(2, 'B駅', 'B St', k=1), node(3, 'B駅', 'B St', k=1.01), node(4, '', k=1.5),
             node(5, 'C駅', 'C St', k=2), node(6, 'D駅', k=3),
             node(11, '甲', lat=LAT + 0.05, k=0), node(12, '乙', lat=LAT + 0.05, k=0.5), node(13, '丙', lat=LAT + 0.05, k=1)]
    rels = [
        rel(100, {'route': 'subway', 'name': 'テスト地下鉄線 (A駅 => D駅)', 'name:en': 'Test Line (A => D)', 'colour': '#e5171f'},
            [(1, 'stop'), (2, 'stop_entry_only'), (3, 'stop'), (4, 'stop'), (5, 'stop'), (6, 'stop_exit_only'), (11, 'platform')]),
        rel(200, {'route': 'tram', 'name': '路面線', 'interval': '00:10', 'colour': 'red'},
            [(11, 'platform'), (12, 'platform'), (13, 'platform_exit_only')]),
        rel(300, {'route': 'train', 'name': '特急くろしお', 'operator': '西日本旅客鉄道'}, [(1, 'stop'), (6, 'stop')]),
        rel(400, {'route': 'train', 'name': '新線', 'service': 'high_speed'}, [(1, 'stop'), (6, 'stop')]),
        rel(500, {'route': 'train', 'name': '一駅線'}, [(1, 'stop'), (4, 'stop')]),
    ]
    return {'elements': rels + nodes}


def network(fetched=1000.0):
    return rail.Network(rail.lines_of(rail.compact(answer())), fetched)


def pt(k, lat=LAT):
    return (lat + 0.001, 135.50 + STEP * k)


# 試験の駅は 1 km おきなので、近い組みを省く距離は、それを確かめる試験のほかでは 0 にする
_MIN_PAIR = rail.MIN_PAIR_M


def setUpModule():
    rail.MIN_PAIR_M = 0


def tearDownModule():
    rail.MIN_PAIR_M = _MIN_PAIR


class NameTest(unittest.TestCase):
    def test_route_ends_are_removed(self):
        self.assertEqual(rail.clean_name('Osaka Metro御堂筋線 (江坂 => なかもず)'), 'Osaka Metro御堂筋線')
        self.assertEqual(rail.clean_name('近鉄特急ひのとり（大阪難波 => 近鉄名古屋）'), '近鉄特急ひのとり')
        self.assertEqual(rail.clean_name('サンダーバード: 大阪 -> 敦賀'), 'サンダーバード')
        self.assertEqual(rail.clean_name('JR大阪環状線 (内回り)'), 'JR大阪環状線 (内回り)')

    def test_colour(self):
        self.assertEqual(rail.colour_of('#e5171f'), 'E5171F')
        self.assertEqual(rail.colour_of('F00'), 'FF0000')
        self.assertEqual(rail.colour_of('red'), 'FF0000')
        self.assertEqual(rail.colour_of('darkgreen'), '006400')
        self.assertEqual(rail.colour_of('DeepSkyBlue'), '00BFFF')
        self.assertIsNone(rail.colour_of('reddish'))
        self.assertIsNone(rail.colour_of(None))


class FilterTest(unittest.TestCase):
    def test_paid_and_long_distance_are_dropped(self):
        drop = [{'name': '特急はるか (京都 => 関西空港)', 'operator': '西日本旅客鉄道'},
                {'name': '近鉄特急ひのとり', 'operator': '近畿日本鉄道'},
                {'name': '特急ラピートα (なんば => 関西空港)'},
                {'name': '小田急ロマンスカー'},
                {'name': 'サンダーバード: 大阪 -> 敦賀', 'operator': 'JR West'},
                {'name': '東海道新幹線'},
                {'name': 'Some Line', 'service': 'high_speed'},
                {'name': '寝台特急サンライズ'},
                {'name': '夜行', 'service': 'night'}]
        for t in drop:
            self.assertTrue(rail.unwanted(t), t)

    def test_shinkansen_train_names_are_left_out(self):
        self.assertTrue(rail.unwanted({'name': 'のぞみ', 'operator': '東海旅客鉄道'}))
        self.assertTrue(rail.unwanted({'name': 'こだま (東京 => 新大阪)'}))
        self.assertTrue(rail.unwanted({'name': '新幹線 みずほ', 'name:en': 'Mizuho'}))
        self.assertFalse(rail.unwanted({'name': 'さくら夙川線'}))

    def test_express_without_operator_is_left_out(self):
        self.assertTrue(rail.unwanted({'name': '踊り子 (東京 => 伊豆急下田)'}))
        self.assertTrue(rail.unwanted({'name': '特急踊り子'}))
        self.assertFalse(rail.unwanted({'name': 'くろしお線'}))
        self.assertTrue(rail.unwanted({'name': 'JR成田エクスプレス'}))
        self.assertTrue(rail.unwanted({'name': 'えのしま'}))
        self.assertFalse(rail.unwanted({'name': '小田急江ノ島線'}))

    def test_free_expresses_are_kept(self):
        keep = [{'name': '阪急京都本線 特急 (京都河原町 => 大阪梅田)', 'operator': '阪急電鉄'},
                {'name': '直通特急 (大阪梅田 => 山陽姫路)'},
                {'name': '京急本線 快特', 'operator': '京浜急行電鉄'},
                {'name': '特急サザン (なんば => 和歌山市)', 'operator': '南海電気鉄道'},
                {'name': 'JR東西線', 'operator': '西日本旅客鉄道'},
                {'name': 'くろしお線'}]
        for t in keep:
            self.assertFalse(rail.unwanted(t), t)


class LinesTest(unittest.TestCase):
    def setUp(self):
        self.lines = {ln.rid: ln for ln in rail.lines_of(rail.compact(answer()))}

    def test_only_usable_lines_remain(self):
        self.assertEqual(sorted(self.lines), [100, 200])

    def test_stops_in_order_without_repeats_or_unnamed(self):
        ln = self.lines[100]
        self.assertEqual(ln.names, ['A駅', 'B駅', 'C駅', 'D駅'])
        self.assertEqual(ln.names_en, ['A St', 'B St', 'C St', 'D駅'])
        self.assertEqual((ln.name, ln.name_en, ln.color, ln.mode, ln.wait), ('テスト地下鉄線', 'Test Line', 'E5171F', 'subway', 3))

    def test_platforms_only_when_no_stops(self):
        ln = self.lines[200]
        self.assertEqual(ln.names, ['甲', '乙', '丙'])
        self.assertEqual(ln.color, 'FF0000')
        self.assertEqual(ln.wait, 5)

    def test_ride_time_formula(self):
        self.assertAlmostEqual(rail.segment_min('subway', 0.5), 0.6 + 0.5 / 40 * 60)
        self.assertAlmostEqual(rail.segment_min('subway', 3.0), 0.6 + 3.0 / 55 * 60)
        self.assertAlmostEqual(rail.segment_min('train', 5.0), 0.5 + 5.0 / 70 * 60)
        self.assertAlmostEqual(rail.segment_min('monorail', 10.0), 0.5 + 10.0 / 90 * 60)
        self.assertAlmostEqual(rail.segment_min('tram', 1.0), 0.4 + 1.0 / 15 * 60)
        ln = self.lines[100]
        km = bus.dist_m(ln.lat[0], ln.lng[0], ln.lat[1], ln.lng[1]) * 1.1 / 1000
        self.assertAlmostEqual(ln.ride(0, 1), rail.segment_min('subway', km))
        self.assertAlmostEqual(ln.ride(3, 1), ln.ride(1, 3))

    def test_wait(self):
        self.assertEqual(rail.wait_of({'interval': '10'}, 'subway'), 5)
        self.assertEqual(rail.wait_of({'interval': '1:00'}, 'train'), 15)
        self.assertEqual(rail.wait_of({'interval': '2'}, 'train'), 2)
        self.assertEqual(rail.wait_of({'interval': 'often'}, 'tram'), 4)
        self.assertEqual([rail.wait_of({}, m) for m in ('subway', 'tram', 'light_rail', 'monorail', 'train')], [3, 4, 4, 4, 5])


class BorrowTest(unittest.TestCase):
    def test_colourless_line_borrows_from_the_one_sharing_stations(self):
        stops = [(LAT, 135.50 + STEP * k, f'{k}駅', '') for k in range(5)]
        local = rail.Line(1, {'name': '本線 普通', 'colour': '#FF4500', 'route': 'train'}, stops, '阪神')
        express = rail.Line(2, {'name': '直通特急', 'route': 'train'}, [stops[0], stops[2], stops[4]], '阪神')
        other = rail.Line(3, {'name': '他社線', 'route': 'train'}, [stops[0], stops[2], stops[4]], '別の会社')
        lonely = rail.Line(4, {'name': '支線', 'route': 'train'}, stops[:2], '阪神')
        apart = [(LAT + 0.02, lng, nm, en) for lat, lng, nm, en in stops]
        namesake = rail.Line(5, {'name': '同じ名前の駅の線', 'route': 'train'}, apart)
        rail.borrow_colours([local, express, other, lonely, namesake])
        self.assertEqual((express.color, other.color, lonely.color, namesake.color), ('FF4500', None, None, None))


class BestTest(unittest.TestCase):
    def setUp(self):
        self.net = network()

    def test_near_pairs_are_left_to_walking(self):
        rail.MIN_PAIR_M = _MIN_PAIR
        try:
            got = self.net.best([pt(0), pt(1), pt(3)])
        finally:
            rail.MIN_PAIR_M = 0
        self.assertIsNone(got[0][1])
        self.assertIsNone(got[1][0])
        self.assertIsNotNone(got[0][2])

    def test_both_directions(self):
        got = self.net.best([pt(0), pt(2)])
        a, b = got[0][1], got[1][0]
        self.assertEqual(self.net.lines[a[1]].rid, 100)
        self.assertEqual((a[2], a[3], b[2], b[3]), (0, 2, 2, 0))
        total, li, k, l, wt, wait, ride, wf = a
        self.assertEqual(total, wt + wait + ride + wf)
        self.assertEqual(wait, 3)
        self.assertEqual(wt, bus.walk_min(bus.dist_m(*pt(0), self.net.lines[li].lat[0], self.net.lines[li].lng[0])))

    def test_far_points_and_same_station(self):
        got = self.net.best([pt(0), pt(0.05), (35.5, 136.5)])
        self.assertIsNone(got[0][1])
        self.assertIsNone(got[0][2])
        self.assertIsNone(got[2][0])

    def test_shortest_pair_of_stations(self):
        got = self.net.best([pt(0.9), pt(3)])[0][1]
        self.assertEqual((got[2], got[3]), (1, 3))

    def test_option_shape_and_language(self):
        c = self.net.best([pt(0), pt(2)])[0][1]
        o = self.net.opt(c, 'ja')
        self.assertEqual(o['line'], 'テスト地下鉄線')
        self.assertEqual((o['board']['name'], o['alight']['name'], o['stops'], o['mode'], o['color']), ('A駅', 'C駅', 2, 'subway', 'E5171F'))
        self.assertEqual(o['path'][0], [o['board']['lng'], o['board']['lat']])
        self.assertEqual(len(o['path']), 3)
        self.assertTrue(all(isinstance(o[k], int) for k in ('walkTo', 'wait', 'ride', 'walkFrom', 'stops')))
        e = self.net.opt(self.net.best([pt(2), pt(0)])[0][1], 'en')
        self.assertEqual((e['line'], e['board']['name'], e['alight']['name']), ('Test Line', 'C St', 'A St'))
        self.assertEqual(e['path'][-1], [e['alight']['lng'], e['alight']['lat']])

    def test_has_lines(self):
        self.assertTrue(self.net.has_lines((LAT - 0.01, 135.49, LAT + 0.01, 135.53)))
        self.assertFalse(self.net.has_lines((LAT - 0.01, 135.49, LAT + 0.01, 135.505)))

    def test_sixty_points_are_quick(self):
        pts = [(LAT + (i % 6) * 0.004, 135.50 + (i // 6) * 0.004) for i in range(60)]
        t = time.time()
        self.net.best(pts)
        self.assertLess(time.time() - t, 1.0)


class MergeTest(unittest.TestCase):
    def test_timetable_values_stay_and_rail_fills_the_rest(self):
        net = network()
        pts = [pt(0), pt(2), pt(3)]
        table = [[None, 7, None], [None, None, None], [None, None, None]]
        minutes, part = rail.merge(table, net.best(pts), net, 'ja')
        self.assertEqual(minutes[0][1], 7)
        self.assertIsNone(part['via'][0][1])
        self.assertIsNone(minutes[0][0])
        for i, j in ((0, 2), (1, 0), (2, 0), (1, 2)):
            o = part['opts'][part['via'][i][j]]
            self.assertEqual(minutes[i][j], o['walkTo'] + o['wait'] + o['ride'] + o['walkFrom'])
        self.assertEqual(len({json.dumps(o, sort_keys=True) for o in part['opts']}), len(part['opts']))

    def test_same_option_is_shared(self):
        net = network()
        pts = [pt(0), pt(0.02), pt(2)]
        _, part = rail.merge(None, net.best(pts), net, 'ja')
        self.assertEqual(part['via'][0][2], part['via'][1][2])

    def test_nothing_from_rail(self):
        net = network()
        minutes, part = rail.merge([[None, 5], [6, None]], net.best([pt(0), (35.5, 136.5)]), net)
        self.assertEqual(minutes, [[None, 5], [6, None]])
        self.assertIsNone(part)


class FakeOverpass:
    def __init__(self, result=None, error=None, block=False):
        self.result, self.error = result if result is not None else answer(), error
        self.calls = []
        self.gate = threading.Event()
        if not block:
            self.gate.set()

    def __call__(self, box):
        self.calls.append(box)
        self.gate.wait(5)
        if self.error:
            raise self.error
        return self.result


def wait_until(fn, limit=5.0):
    end = time.time() + limit
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.01)
    return fn()


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.clock = [1_000_000.0]
        self.slept = []

    def tearDown(self):
        self.tmp.cleanup()

    def store(self, fetch):
        return rail.Store(self.dir, fetch=fetch, now=lambda: self.clock[0], sleep=self.slept.append, on=lambda: True)

    def ready(self, st, pts):
        return wait_until(lambda: (lambda r: r if r[1] != 'pending' else None)(st.get(pts)))

    def test_pending_then_ready_and_saved(self):
        fake = FakeOverpass(block=True)
        st = self.store(fake)
        pts = [pt(0), pt(2)]
        self.assertEqual(st.get(pts), (None, 'pending'))
        self.assertEqual(st.get(pts), (None, 'pending'))
        fake.gate.set()
        net, state = self.ready(st, pts)
        self.assertEqual(state, 'ready')
        self.assertEqual(len(fake.calls), 1)
        self.assertEqual(fake.calls[0], rail.key_box(pts))
        self.assertEqual(os.listdir(self.dir), [rail.box_name(rail.key_box(pts))])
        again = self.store(FakeOverpass(error=AssertionError('must not ask')))
        net2, state2 = again.get(pts)
        self.assertEqual((state2, len(net2.lines), net2.fetched), ('ready', 2, net.fetched))

    def test_wider_area_is_reused(self):
        fake = FakeOverpass()
        st = self.store(fake)
        wide = [pt(0), pt(3), (LAT + 0.2, 135.8)]
        self.ready(st, wide)
        net, state = st.get([pt(0), pt(2)])
        self.assertEqual((state, len(fake.calls)), ('ready', 1))

    def test_narrow_area_inside_the_one_being_fetched_is_not_asked_again(self):
        fake = FakeOverpass(block=True)
        st = self.store(fake)
        wide = [pt(0), pt(3), (LAT + 0.2, 135.8)]
        self.assertEqual(st.get(wide), (None, 'pending'))
        self.assertEqual(st.get([pt(0), pt(2)]), (None, 'pending'))
        fake.gate.set()
        _, state = self.ready(st, [pt(0), pt(2)])
        self.assertEqual((state, len(fake.calls)), ('ready', 1))

    def test_busy_server_is_not_asked_again_for_a_while(self):
        fake = FakeOverpass(error=rail.Busy('HTTP 429'))
        st = self.store(fake)
        pts = [pt(0), pt(2)]
        self.assertEqual(st.get(pts)[1], 'pending')
        self.assertEqual(self.ready(st, pts), (None, 'none'))
        self.clock[0] += rail.RETRY_AFTER - 10
        self.assertEqual(st.get(pts), (None, 'none'))
        self.assertEqual(len(fake.calls), 1)
        self.clock[0] += 20
        fake.error = None
        self.assertEqual(st.get(pts)[1], 'pending')
        self.assertEqual(self.ready(st, pts)[1], 'ready')
        self.assertEqual(len(fake.calls), 2)

    def test_other_failures_count_as_none(self):
        st = self.store(FakeOverpass(error=ValueError('runtime error')))
        pts = [pt(0), pt(2)]
        st.get(pts)
        self.assertEqual(self.ready(st, pts), (None, 'none'))
        self.assertEqual(os.listdir(self.dir), [])

    def test_empty_area_is_remembered(self):
        fake = FakeOverpass(result={'elements': []})
        st = self.store(fake)
        pts = [pt(0), pt(2)]
        st.get(pts)
        net, state = self.ready(st, pts)
        self.assertEqual((state, net.lines), ('ready', []))
        st.get(pts)
        self.assertEqual(len(fake.calls), 1)

    def test_old_data_is_used_while_asking_again(self):
        fake = FakeOverpass()
        st = self.store(fake)
        pts = [pt(0), pt(2)]
        st.get(pts)
        first, _ = self.ready(st, pts)
        self.clock[0] += rail.REFRESH + 1
        fake.gate.clear()
        net, state = st.get(pts)
        self.assertEqual((state, net.fetched), ('ready', first.fetched))
        fake.gate.set()
        newer = wait_until(lambda: (lambda n: n if n.fetched > first.fetched else None)(st.get(pts)[0]))
        self.assertIsNotNone(newer)
        self.assertEqual(len(fake.calls), 2)

    def test_one_at_a_time_with_a_gap(self):
        fake = FakeOverpass()
        st = self.store(fake)
        a, b = [pt(0), pt(2)], [(36.5, 137.5), (36.51, 137.51)]
        st.get(a)
        st.get(b)
        self.ready(st, a)
        self.ready(st, b)
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(self.slept, [rail.GAP])

    def test_daily_limit(self):
        fake = FakeOverpass()
        st = self.store(fake)
        saved = rail.PER_DAY
        rail.PER_DAY = 1
        try:
            a, b = [pt(0), pt(2)], [(36.5, 137.5), (36.51, 137.51)]
            st.get(a)
            self.ready(st, a)
            st.get(b)
            self.assertEqual(self.ready(st, b), (None, 'none'))
            self.assertEqual(len(fake.calls), 1)
        finally:
            rail.PER_DAY = saved

    def test_off(self):
        st = rail.Store(self.dir, fetch=FakeOverpass(), on=lambda: False)
        self.assertEqual(st.get([pt(0), pt(2)]), (None, 'off'))
        os.environ['ZT_RAIL'] = '1'
        try:
            self.assertTrue(rail.enabled())
        finally:
            os.environ['ZT_RAIL'] = '0'
        self.assertFalse(rail.enabled())


class CompactTest(unittest.TestCase):
    def test_keeps_only_what_is_used(self):
        raw = rail.compact(answer())
        r = next(x for x in raw['rels'] if x['id'] == 100)
        self.assertEqual(r['members'][0], [1, 'stop'])
        self.assertNotIn('type', r['tags'])
        self.assertEqual(raw['nodes']['1'], [LAT, 135.5, 'A駅', 'A St'])


# ---- /api/bus-table・/api/bus-info ----
import app  # noqa: E402


def call(port, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else b''
    head = f'{method} {path} HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: {len(data)}\r\n\r\n'.encode()
    s = socket.create_connection(('127.0.0.1', port), timeout=10)
    try:
        s.sendall(head + data)
        buf = b''
        while True:
            c = s.recv(65536)
            if not c:
                break
            buf += c
    finally:
        s.close()
    top, _, rest = buf.partition(b'\r\n\r\n')
    return int(top.split(b' ')[1]), json.loads(rest)


class FakeIdx:
    meta = {'feed': 'f', 'res': 'r', 'fetched': 1, 'region': None}


class FakeBus:
    def __init__(self, on=True, idxs=(), pending=False):
        self.on, self.idxs, self.pending = on, list(idxs), pending

    def enabled(self):
        return self.on

    def indexes(self, box, ymd, wait=25.0):
        return self.idxs, self.pending


class FakeRail:
    def __init__(self, net=None, state='ready', on=True):
        self.net, self.state, self.on = net, state, on
        self.asked = []

    def enabled(self):
        return self.on

    def get(self, points):
        self.asked.append(points)
        return self.net, self.state

    def get_box(self, box):
        self.asked.append(box)
        return self.net, self.state


class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), app.H)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self.saved = app.BUS, app.RAIL, bus.door_table, app.BUS_RATE
        app.BUS_RATE = bus.Rate(0, 0)
        app.BUS_TABLES.clear()
        self.pts = [list(pt(0)), list(pt(2)), list(pt(3))]

    def tearDown(self):
        app.BUS, app.RAIL, bus.door_table, app.BUS_RATE = self.saved
        app.BUS_TABLES.clear()

    def table(self, **extra):
        return call(self.port, 'POST', '/api/bus-table', {'points': self.pts, 'date': '2026-11-08', 'start': 540, 'end': 1080, **extra})

    def test_timetable_area_does_not_use_rail(self):
        app.BUS = FakeBus(idxs=[FakeIdx()])
        app.RAIL = FakeRail(network())
        bus.door_table = lambda *a, **k: [[None, 11, None], [None, None, None], [None, None, None]]
        code, d = self.table()
        self.assertEqual(code, 200)
        self.assertEqual(d['minutes'], [[None, 11, None], [None, None, None], [None, None, None]])
        self.assertNotIn('rail', d)
        self.assertEqual(app.RAIL.asked, [])

    def test_rail_names_follow_the_language(self):
        app.BUS = FakeBus()
        app.RAIL = FakeRail(network())
        _, d = self.table()
        o = d['rail']['opts'][d['rail']['via'][0][2]]
        self.assertEqual(d['minutes'][0][2], o['walkTo'] + o['wait'] + o['ride'] + o['walkFrom'])
        self.assertEqual(o['line'], 'テスト地下鉄線')
        _, e = self.table(lang='en')
        self.assertEqual(e['rail']['opts'][e['rail']['via'][0][2]]['line'], 'Test Line')

    def test_rail_only_area(self):
        app.BUS = FakeBus(on=False)
        app.RAIL = FakeRail(network())
        code, d = self.table()
        self.assertEqual(code, 200)
        self.assertIsNotNone(d['minutes'][0][2])
        self.assertEqual(d['sources'], [])

    def test_no_rail_key_when_unused(self):
        app.BUS = FakeBus(idxs=[FakeIdx()])
        app.RAIL = FakeRail(rail.Network([], 1.0))
        bus.door_table = lambda *a, **k: [[None, 4, None], [None, None, None], [None, None, None]]
        _, d = self.table()
        self.assertNotIn('rail', d)
        self.assertEqual(d['minutes'][0][1], 4)

    def test_none_and_loading(self):
        app.BUS = FakeBus()
        app.RAIL = FakeRail(rail.Network([], 1.0))
        self.assertEqual(self.table()[1], {'none': True})
        app.RAIL = FakeRail(None, 'none')
        self.assertEqual(self.table()[1], {'none': True})
        app.RAIL = FakeRail(None, 'pending')
        self.assertEqual(self.table()[1], {'loading': True})
        app.BUS = FakeBus(idxs=[FakeIdx()])
        bus.door_table = lambda *a, **k: [[None, 4, None], [None, None, None], [None, None, None]]
        d = self.table()[1]
        self.assertEqual((d['minutes'][0][1], 'railLoading' in d, 'rail' in d), (4, False, False))
        app.BUS = FakeBus(pending=True)
        app.RAIL = FakeRail(network())
        self.assertEqual(self.table()[1], {'loading': True})

    def test_rail_off_keeps_old_answers(self):
        app.BUS = FakeBus(on=False)
        app.RAIL = FakeRail(on=False)
        self.assertEqual(self.table()[1], {'off': True})
        self.assertEqual(call(self.port, 'GET', '/api/bus-info?date=2026-11-08&box=34.70,135.50,34.71,135.53')[1], {'on': False})

    def test_bus_info_tells_about_rail(self):
        app.BUS = FakeBus()
        app.RAIL = FakeRail(network())
        _, d = call(self.port, 'GET', f'/api/bus-info?date=2026-11-08&box={LAT},135.50,{LAT + 0.002},135.533')
        self.assertEqual((d['on'], d['rail'], d['railLoading']), (False, True, False))
        app.RAIL = FakeRail(None, 'pending')
        _, d = call(self.port, 'GET', f'/api/bus-info?date=2026-11-08&box={LAT},135.50,{LAT + 0.002},135.533')
        self.assertEqual((d['on'], d['rail'], d['railLoading']), (False, False, True))
        self.assertEqual(app.RAIL.asked, [rail.key_box([(LAT, 135.50), (LAT + 0.002, 135.533)])])


if __name__ == '__main__':
    unittest.main()
