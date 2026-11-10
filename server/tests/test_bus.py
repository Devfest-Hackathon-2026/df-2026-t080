# bus.py の試験。cd server && python3 -m unittest discover -s tests
# 本物の京都市バスの GTFS（zip）で試すときは ZT_BUS_GTFS_CITY にその場所を渡す（無ければその試験は飛ばす）。
import csv, io, os, sys, tempfile, threading, time, unittest, zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bus  # noqa: E402

FEED = bus.FEEDS[0]

# 東西に並ぶ 4 つの停留所。O は出発の点のすぐ近く、D は着く点のすぐ近く
STOPS = [('S1', '西の端', 35.0000, 135.7000), ('O', '出発前', 35.0000, 135.7500), ('M', '中ほど', 35.0000, 135.7700),
         ('D', '到着前', 35.0000, 135.7900)]
ORIGIN = (35.0003, 135.7501)
DEST = (35.0003, 135.7899)


def table(rows):
    buf = io.StringIO()
    csv.writer(buf, lineterminator='\n').writerows(rows)
    return buf.getvalue()


def make_zip(path, extra_trip=False):
    files = {
        'feed_info.txt': [['feed_publisher_name', 'feed_start_date', 'feed_end_date', 'feed_version'], ['試験', '20261101', '20270331', 'v1']],
        'stops.txt': [['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'platform_code']] +
                     [[i, n, la, lo, '0', 'A'] for i, n, la, lo in STOPS],
        'routes.txt': [['route_id', 'route_short_name', 'route_long_name'], ['R1', '市バス２０６', ''], ['R2', '市バス特１７', '']],
        'calendar.txt': [['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
                         ['WD', '1', '1', '1', '1', '1', '0', '0', '20261101', '20270331'],
                         ['HD', '0', '0', '0', '0', '0', '1', '1', '20261101', '20270331']],
        # 11/23（月・祝）は平日の運行を止め、休日の運行にする
        'calendar_dates.txt': [['service_id', 'date', 'exception_type'], ['WD', '20261123', '2'], ['HD', '20261123', '1']],
        'trips.txt': [['route_id', 'service_id', 'trip_id', 'trip_headsign', 'shape_id'],
                      ['R1', 'WD', 'T_WD', '到着前・東の端', 'SH1'],
                      ['R1', 'HD', 'T_HD', '到着前・東の端', 'SH1'],
                      ['R2', 'WD', 'T_NOPICK', '到着前', '']] + ([['R2', 'WD', 'T_LATE', '到着前', '']] if extra_trip else []),
        'stop_times.txt': [['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type', 'stop_headsign'],
                           ['T_WD', '10:00:00', '10:00:00', 'S1', '1', '0', '1', ''],
                           ['T_WD', '10:05:00', '10:05:00', 'O', '2', '0', '0', ''],
                           ['T_WD', '10:10:00', '10:10:00', 'M', '3', '0', '0', ''],
                           ['T_WD', '10:15:00', '10:15:00', 'D', '4', '1', '0', ''],
                           ['T_HD', '11:00:00', '11:00:00', 'S1', '1', '0', '1', ''],
                           ['T_HD', '11:05:00', '11:05:00', 'O', '2', '0', '0', ''],
                           ['T_HD', '11:10:00', '11:10:00', 'M', '3', '0', '0', ''],
                           ['T_HD', '11:15:00', '11:15:00', 'D', '4', '1', '0', ''],
                           # 出発前の停留所では乗れない便（降りるだけ）
                           ['T_NOPICK', '10:20:00', '10:20:00', 'O', '1', '1', '0', ''],
                           ['T_NOPICK', '10:30:00', '10:30:00', 'D', '2', '1', '0', '']] +
                          ([['T_LATE', '10:40:00', '10:40:00', 'O', '1', '0', '0', ''], ['T_LATE', '10:50:00', '10:50:00', 'D', '2', '1', '0', '']]
                           if extra_trip else []),
        'shapes.txt': [['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence']] +
                      [['SH1', '35.0001', f'{135.70 + i * 0.005:.4f}', str(i)] for i in range(21)],
    }
    with zipfile.ZipFile(path, 'w') as zf:
        for name, rows in files.items():
            zf.writestr(name, table(rows))


class Synthetic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.zip = os.path.join(cls.tmp, 'feed.zip')
        make_zip(cls.zip)
        cls.idx = bus.build(cls.zip, FEED, {'res': '20261101', 'fetched': time.time()})

    def test_weekday_and_holiday(self):
        mon = self.idx.search(ORIGIN, DEST, 20261109, 10 * 60)
        sat = self.idx.search(ORIGIN, DEST, 20261107, 10 * 60)
        holiday = self.idx.search(ORIGIN, DEST, 20261123, 10 * 60)
        self.assertEqual([t['board']['time'] for t in mon], ['10:05'])
        self.assertEqual([t['board']['time'] for t in sat], ['11:05'])
        self.assertEqual([t['board']['time'] for t in holiday], ['11:05'])

    def test_trip_fields(self):
        t = self.idx.search(ORIGIN, DEST, 20261109, 9 * 60)[0]
        self.assertEqual(t['agency'], '市バス')
        self.assertEqual(t['route'], '206')
        self.assertEqual((t['board']['name'], t['alight']['name'], t['alight']['time']), ('出発前', '到着前', '10:15'))
        self.assertEqual(t['stops'], 2)
        self.assertEqual(t['via'], [{'name': '中ほど', 'time': '10:10'}])   # 乗る所と降りる所は入れない
        self.assertGreaterEqual(t['walkTo'], 1)

    def test_window(self):
        self.assertEqual(self.idx.search(ORIGIN, DEST, 20261107, 9 * 60), [])   # 2 時間より先の便は出さない

    def test_after_and_walk(self):
        self.assertEqual(self.idx.search(ORIGIN, DEST, 20261109, 10 * 60 + 5), [])   # 歩く分だけ間に合わない

    def test_no_pickup_stop(self):
        trips = self.idx.search(ORIGIN, DEST, 20261109, 10 * 60 + 10)
        self.assertEqual(trips, [])                       # 乗れない便は出さない

    def test_line_is_cut_to_ride(self):
        t = self.idx.search(ORIGIN, DEST, 20261109, 9 * 60)[0]
        self.assertTrue(t['shape'])
        xs = [p[0] for p in t['line']]
        self.assertAlmostEqual(xs[0], 135.75, places=3)
        self.assertAlmostEqual(xs[-1], 135.79, places=3)
        self.assertTrue(all(135.749 <= x <= 135.791 for x in xs))   # 乗る前・降りた後の形は入れない

    def test_save_and_load(self):
        path = os.path.join(self.tmp, 'x.idx')
        self.idx.save(path)
        again = bus.Index.load(path)
        self.assertEqual(again.search(ORIGIN, DEST, 20261109, 9 * 60), self.idx.search(ORIGIN, DEST, 20261109, 9 * 60))

    def test_door_table(self):
        store = bus.Store(tempfile.mkdtemp(), key_fn=lambda: 'k', fetch=lambda feed, res, dest: make_zip(dest), catalog=lambda feed: [])
        tb = bus.door_table(store, [ORIGIN, DEST], 20261109, 600, 720)
        # 10:00 に出ると、停留所まで 1 分・待ち 4 分・乗って 10 分・停留所から 1 分。11:00 は便が無い（2 回のうち 1 回で足りる）
        self.assertEqual(tb[0][1], 16)
        self.assertIsNone(tb[1][0])
        self.assertIsNone(tb[0][0])
        late = bus.door_table(store, [ORIGIN, DEST], 20261109, 600, 900)
        self.assertIsNone(late[0][1])                     # 4 回のうち 1 回だけでは目安にしない

    def test_door_table_caps_wait(self):
        store = bus.Store(tempfile.mkdtemp(), key_fn=lambda: 'k', fetch=lambda feed, res, dest: make_zip(dest), catalog=lambda feed: [])
        tb = bus.door_table(store, [ORIGIN, DEST], 20261109, 9 * 60 + 15, 10 * 60)
        self.assertEqual(tb[0][1], 1 + bus.WAIT_CAP + 10 + 1)   # 49 分待ちは 15 分として数える

    def test_far_points(self):
        self.assertEqual(self.idx.search((35.1, 135.7), DEST, 20261109, 9 * 60), [])


class StoreTest(unittest.TestCase):
    def make(self, key='k', catalog=None):
        tmp = tempfile.mkdtemp()
        calls = []
        clock = [1_800_000_000.0]

        def fetch(feed, res, dest):
            calls.append((feed['id'], res))
            make_zip(dest, extra_trip=len(calls) > 1)
        store = bus.Store(tmp, key_fn=lambda: key, fetch=fetch, catalog=catalog or (lambda feed: []), now=lambda: clock[0])
        return store, calls, clock

    def test_no_key_does_nothing(self):
        store, calls, _ = self.make(key='')
        self.assertFalse(store.enabled())
        self.assertIsNone(store.get(FEED, 20261109))
        self.assertEqual(bus.find(store, ORIGIN, DEST, 20261109, 9 * 60), ([], []))
        self.assertEqual(calls, [])

    def test_refetch_after_seven_days(self):
        store, calls, clock = self.make()
        idx = store.get(FEED, 20261109)
        self.assertIsNotNone(idx)
        self.assertEqual(calls, [('city', 'current')])
        clock[0] += 6 * 86400
        self.assertIs(store.get(FEED, 20261109), idx)
        self.assertEqual(len(calls), 1)
        clock[0] += 2 * 86400
        old = store.get(FEED, 20261109)
        self.assertIs(old, idx)                            # 取り直している間は古い版を使う
        deadline = time.time() + 10
        while store.busy and time.time() < deadline:
            time.sleep(0.05)
        self.assertEqual(len(calls), 2)
        new = store.get(FEED, 20261109)
        self.assertIsNot(new, idx)
        self.assertEqual(len(new.search(ORIGIN, DEST, 20261109, 10 * 60 + 10)), 1)   # 取り直した版の便

    def test_cache_on_disk_is_reused(self):
        store, calls, clock = self.make()
        store.get(FEED, 20261109)
        store2 = bus.Store(store.dir, key_fn=lambda: 'k', fetch=lambda *a: calls.append(a), catalog=lambda feed: [], now=lambda: clock[0] + 86400)
        self.assertIsNotNone(store2.get(FEED, 20261109))
        self.assertEqual(len(calls), 1)

    def test_pick_version_by_date(self):
        lst = [{'res': '20261102', 'uploaded': '2026-10-28T19:15', 'version': 'a'},
               {'res': '20261107', 'uploaded': '2026-11-05T15:36', 'version': 'b'},
               {'res': '20261109', 'uploaded': '2026-11-06T11:22', 'version': 'c'}]
        store, _, _ = self.make(catalog=lambda feed: lst)
        self.assertEqual(store.pick(FEED, 20261108), '20261107')
        self.assertEqual(store.pick(FEED, 20261109), '20261109')
        self.assertEqual(store.pick(FEED, 20261101), '20261102')
        self.assertEqual(store.pick(FEED, 20261231), '20261109')

    def test_pick_version_without_start_date(self):
        lst = [{'res': '6c1f0e9a-0000-4000-8000-000000000001', 'start': '', 'uploaded': '2026-09-01T10:00'},
               {'res': '6c1f0e9a-0000-4000-8000-000000000002', 'start': '', 'uploaded': '2026-10-01T10:00'},
               {'res': '6c1f0e9a-0000-4000-8000-000000000003', 'start': '20261201', 'uploaded': '2026-11-01T10:00'}]
        store, _, _ = self.make(catalog=lambda feed: lst)
        self.assertEqual(store.pick(FEED, 20261108), '6c1f0e9a-0000-4000-8000-000000000002')
        self.assertEqual(store.pick(FEED, 20261201), '6c1f0e9a-0000-4000-8000-000000000003')

    def test_catalog_failure_uses_current(self):
        def broken(feed):
            raise OSError('down')
        store, _, _ = self.make(catalog=broken)
        self.assertEqual(store.pick(FEED, 20261109), 'current')

    def test_key_not_in_errors(self):
        secret = 'SECRET-KEY-1234567890'
        store = bus.Store(tempfile.mkdtemp(), key_fn=lambda: secret)
        saved = bus.FILES
        bus.FILES = 'http://127.0.0.1:9/{org}/{ds}.zip'
        try:
            with self.assertRaises(RuntimeError) as cm:
                store._fetch_zip(FEED, 'current', os.path.join(store.dir, 'x.zip'))
        finally:
            bus.FILES = saved
        self.assertNotIn(secret, str(cm.exception))
        self.assertIsNone(cm.exception.__cause__)

    def test_concurrent_get_fetches_once(self):
        store, calls, _ = self.make()
        out = []
        th = [threading.Thread(target=lambda: out.append(store.get(FEED, 20261109))) for _ in range(5)]
        for t in th:
            t.start()
        for t in th:
            t.join()
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(x is not None for x in out))


def make_long_zip(path):
    """東へ 52 の停留所（L0〜L51）を順に止まる 1 便。L10 は通るだけ（乗り降りできない）。L1 には英語の名前がある"""
    stops = [(f'L{i}', f'長い道{i}', 35.0, round(135.0 + i * 0.01, 4)) for i in range(52)]
    times = [['T_LONG', f'10:{i:02d}:00', f'10:{i:02d}:00', sid, str(i + 1), '1' if i in (10, 51) else '0', '1' if i in (0, 10) else '0']
             for i, (sid, _, _, _) in enumerate(stops)]
    files = {
        'stops.txt': [['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'platform_code']] + [[i, n, la, lo, '0', ''] for i, n, la, lo in stops],
        'routes.txt': [['route_id', 'route_short_name', 'route_long_name'], ['R1', '市バス２０６', '']],
        'calendar.txt': [['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
                         ['WD', '1', '1', '1', '1', '1', '1', '1', '20261101', '20270331']],
        'trips.txt': [['route_id', 'service_id', 'trip_id', 'trip_headsign'], ['R1', 'WD', 'T_LONG', '長い道51']],
        'stop_times.txt': [['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type']] + times,
        'translations.txt': [['table_name', 'field_name', 'language', 'translation', 'record_id'], ['stops', 'stop_name', 'en', 'Long Road 1', 'L1']],
    }
    with zipfile.ZipFile(path, 'w') as zf:
        for name, rows in files.items():
            zf.writestr(name, table(rows))


class Via(unittest.TestCase):
    """便の答えの途中の停留所（via）"""
    A, B = (35.0, 135.0), (35.0, 135.51)

    @classmethod
    def setUpClass(cls):
        tmp = tempfile.mkdtemp()
        z = os.path.join(tmp, 'long.zip')
        make_long_zip(z)
        cls.idx = bus.build(z, FEED, {'res': '20261101', 'fetched': time.time()})

    def trip(self, idx=None):
        got = (idx or self.idx).search(self.A, self.B, 20261109, 9 * 60 + 50)
        self.assertEqual(len(got), 1)
        return got[0]

    def test_skips_pass_through_and_caps(self):
        t = self.trip()
        self.assertEqual((t['board']['name'], t['alight']['name']), ('長い道0', '長い道51'))
        # 間の 50 の行のうち、L10 は通るだけなので数えない
        self.assertEqual(t['stops'], 50)
        self.assertEqual(len(t['via']), bus.VIA_MAX)
        self.assertNotIn('長い道10', [v['name'] for v in t['via']])
        self.assertEqual(t['via'][0], {'name': '長い道1', 'time': '10:01', 'en': 'Long Road 1'})
        self.assertEqual(t['via'][9], {'name': '長い道11', 'time': '10:11'})

    def test_in_lang(self):
        en = bus.in_lang(self.trip(), 'en')
        self.assertEqual(en['via'][0], {'name': 'Long Road 1', 'time': '10:01'})
        self.assertEqual(en['via'][1], {'name': '長い道2', 'time': '10:02'})    # 英語の名前が無ければ元のまま
        ja = bus.in_lang(self.trip(), 'ja')
        self.assertEqual(ja['via'][0], {'name': '長い道1', 'time': '10:01'})
        self.assertTrue(all('en' not in v for v in en['via'] + ja['via']))

    def test_in_lang_without_via(self):
        t = {'agency': '市バス', 'route': '206', 'headsign': 'x', 'board': {'name': 'a'}, 'alight': {'name': 'b'}}
        self.assertEqual(bus.in_lang(dict(t), 'en'), t)              # 前の形の便（via が無い）もそのまま
        self.assertEqual(bus.in_lang({**t, 'via': [None, {'name': 'c', 'time': '1:00'}]}, 'ja')['via'], [{'name': 'c', 'time': '1:00'}])

    def test_index_without_english(self):
        # 英語の名前を持たない作り置き（strings に en が無い）でも答えられる
        old = bus.Index(self.idx.meta, {k: v for k, v in self.idx.s.items() if k != 'en'}, self.idx.a)
        self.assertEqual(self.trip(old)['via'][0], {'name': '長い道1', 'time': '10:01'})


class Misc(unittest.TestCase):
    def test_rate(self):
        r = bus.Rate(2, 3)
        self.assertTrue(r.take('a', 0))
        self.assertTrue(r.take('a', 1))
        self.assertFalse(r.take('a', 2))
        self.assertTrue(r.take('b', 3))
        self.assertFalse(r.take('c', 4))                  # 全体の上限
        self.assertTrue(r.take('a', 3700))                # 1 時間たてば戻る

    def test_rate_weight(self):
        r = bus.Rate(5, 0)
        self.assertTrue(r.take('a', 0, n=4))
        self.assertFalse(r.take('a', 1, n=2))             # 届かない分は数えない
        self.assertTrue(r.take('a', 2, n=1))
        self.assertFalse(r.take('a', 3))
        self.assertTrue(r.take('b', 4, n=5))              # 全体の上限なし
        self.assertTrue(r.take('a', 3601, n=4))

    def test_parse_query(self):
        q = {'from': ['34.9858,135.7588'], 'to': ['34.9949,135.7850'], 'date': ['2026-11-07'], 'after': ['10:00']}
        self.assertEqual(bus.parse_query(q), ((34.9858, 135.7588), (34.9949, 135.785), 20261107, 600))
        self.assertIsNone(bus.parse_query({**q, 'date': ['2026-13-40']}))
        self.assertIsNone(bus.parse_query({**q, 'from': ['abc']}))
        self.assertIsNone(bus.parse_query({**q, 'to': ['0,0']}))


@unittest.skipUnless(os.environ.get('ZT_BUS_GTFS_CITY'), 'ZT_BUS_GTFS_CITY（京都市バスの GTFS の zip）が無い')
class RealCityBus(unittest.TestCase):
    """京都駅→清水寺（2026-11-07 土曜 10 時）。停車の表をそのまま読む素朴な探し方と同じ便が出るか"""

    KYOTO = (34.9858, 135.7588)
    KIYOMIZU = (34.9949, 135.7850)

    @classmethod
    def setUpClass(cls):
        cls.path = os.environ['ZT_BUS_GTFS_CITY']
        cls.idx = bus.build(cls.path, FEED, {'res': 'current', 'fetched': time.time()})

    def brute(self, ymd, after):
        """direct.py と同じ考え方（停留所の近さ・その日の運行・同じ便で後に来る停留所）で、乗る時刻と降りる時刻の組を全部"""
        zf = zipfile.ZipFile(self.path)
        rd = lambda n: list(csv.DictReader(io.TextIOWrapper(zf.open(n), encoding='utf-8-sig')))
        stops = {s['stop_id']: s for s in rd('stops.txt')}
        near = lambda pt: {i: bus.walk_min(bus.dist_m(*pt, float(s['stop_lat']), float(s['stop_lon'])))
                           for i, s in stops.items() if bus.dist_m(*pt, float(s['stop_lat']), float(s['stop_lon'])) <= bus.NEAR_M}
        a, b = near(self.KYOTO), near(self.KIYOMIZU)
        day = f'{ymd}'
        import datetime
        wd = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][datetime.date(ymd // 10000, ymd // 100 % 100, ymd % 100).weekday()]
        svc = {c['service_id'] for c in rd('calendar.txt') if c[wd] == '1' and c['start_date'] <= day <= c['end_date']}
        for c in rd('calendar_dates.txt'):
            if c['date'] == day:
                (svc.add if c['exception_type'] == '1' else svc.discard)(c['service_id'])
        trips = {t['trip_id'] for t in rd('trips.txt') if t['service_id'] in svc}
        by = {}
        for r in rd('stop_times.txt'):
            if r['trip_id'] in trips and (r['stop_id'] in a or r['stop_id'] in b):
                by.setdefault(r['trip_id'], []).append(r)
        pairs = set()
        hm = lambda t: int(t[:2]) * 60 + int(t[3:5])
        for rows in by.values():
            rows.sort(key=lambda r: int(r['stop_sequence']))
            for i, x in enumerate(rows):
                if x['stop_id'] not in a or x['pickup_type'] == '1' or hm(x['departure_time']) < after + a[x['stop_id']]:
                    continue
                for y in rows[i + 1:]:
                    if y['stop_id'] in b and y['drop_off_type'] != '1':
                        pairs.add((bus.hm_text(hm(x['departure_time'])), bus.hm_text(hm(y['arrival_time'])), bus.nfkc(stops[y['stop_id']]['stop_name'])))
        return pairs

    def test_kyoto_to_kiyomizu_saturday(self):
        got = self.idx.search(self.KYOTO, self.KIYOMIZU, 20261107, 600)
        self.assertEqual(len(got), 3)
        first = got[0]
        self.assertEqual((first['route'], first['board']['time'], first['alight']['time'], first['alight']['name']), ('206', '10:08', '10:23', '五条坂'))
        self.assertIn('観光特急EX100', [t['route'] for t in got])
        pairs = self.brute(20261107, 600)
        for t in got:
            self.assertIn((t['board']['time'], t['alight']['time'], t['alight']['name']), pairs)
        self.assertTrue(all(t['shape'] and len(t['line']) > 5 for t in got))

    def test_weekday_differs(self):
        sat = [(t['route'], t['board']['time']) for t in self.idx.search(self.KYOTO, self.KIYOMIZU, 20261107, 600)]
        mon = [(t['route'], t['board']['time']) for t in self.idx.search(self.KYOTO, self.KIYOMIZU, 20261109, 600)]
        self.assertNotEqual(sat, mon)
        self.assertNotIn('観光特急EX100', [r for r, _ in mon])     # 観光特急は土日祝だけ

    def test_line_starts_and_ends_at_stops(self):
        t = self.idx.search(self.KYOTO, self.KIYOMIZU, 20261107, 600)[0]
        a, z = t['line'][0], t['line'][-1]
        self.assertLess(bus.dist_m(a[1], a[0], t['board']['lat'], t['board']['lng']), 5)
        self.assertLess(bus.dist_m(z[1], z[0], t['alight']['lat'], t['alight']['lng']), 5)
        self.assertLess(max(bus.dist_m(p[1], p[0], 34.99, 135.77) for p in t['line']), 3000)


if __name__ == '__main__':
    unittest.main()
