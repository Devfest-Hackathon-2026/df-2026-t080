# 公開の URL の受け口の守りの試験（手元にサーバーを立て、Gemini は偽物）。cd server && python3 -m pytest tests
import json, os, socket, sys, tempfile, threading, unittest
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
os.environ['ZT_LLM_MODULE'] = os.path.join(HERE, 'fake_llm.py')
import app  # noqa: E402

app.PROXY_HOPS = 1                     # 試験では、Cloud Run のように X-Forwarded-For の最後を相手とみなす


def request(port, head, body=b'', wait=5):
    """生の要求を送り、(状態の番号, 本文の dict) を返す。返事が無ければ (None, None)"""
    s = socket.create_connection(('127.0.0.1', port), timeout=wait)
    try:
        s.sendall(head + b'\r\n\r\n' + body)
        buf = b''
        while True:
            c = s.recv(65536)
            if not c:
                break
            buf += c
    except (socket.timeout, ConnectionResetError):
        return None, None
    finally:
        s.close()
    if not buf:
        return None, None
    top, _, rest = buf.partition(b'\r\n\r\n')
    code = int(top.split(b' ')[1])
    try:
        return code, json.loads(rest)
    except ValueError:
        return code, None


def post(port, path, body, who='203.0.113.1'):
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    head = (f'POST {path} HTTP/1.0\r\nContent-Type: application/json\r\nX-Forwarded-For: {who}\r\n'
            f'Content-Length: {len(data)}').encode()
    return request(port, head, data)


class Served(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), app.H)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()


class ContentLengthTest(Served):
    def test_negative_length_is_bad_request(self):
        code, d = request(self.port, b'POST /api/odai HTTP/1.0\r\nContent-Length: -1', b'{}')
        self.assertEqual((code, d), (400, {'error': 'bad'}))

    def test_non_numeric_length_is_bad_request(self):
        for v in (b'abc', b'1e3', b'\xef\xbc\x91'):
            code, d = request(self.port, b'POST /api/odai HTTP/1.0\r\nContent-Length: ' + v, b'{}')
            self.assertEqual((code, d), (400, {'error': 'bad'}), v)

    def test_too_large_is_rejected(self):
        code, d = request(self.port, b'POST /api/odai HTTP/1.0\r\nContent-Length: 99999999')
        self.assertEqual((code, d), (413, {'error': 'large'}))


class TimeoutTest(Served):
    def setUp(self):
        self.saved = app.H.timeout
        app.H.timeout = 1

    def tearDown(self):
        app.H.timeout = self.saved

    def test_wait_is_longer_than_the_long_poll(self):
        self.assertIsNotNone(self.saved)
        self.assertGreater(self.saved, app.LONG_POLL)

    def test_silent_client_is_dropped(self):
        import time
        s = socket.create_connection(('127.0.0.1', self.port), timeout=10)
        t = time.time()
        s.sendall(b'POST /api/odai HTTP/1.0\r\nContent-Length: 100\r\n\r\n{')
        self.assertEqual(s.recv(100), b'')
        self.assertLess(time.time() - t, 5)
        s.close()

    def test_slow_but_steady_upload_is_kept(self):
        import time
        data = json.dumps({'place': {'name': 'x'}, 'pad': 'y' * 600}).encode()
        s = socket.create_connection(('127.0.0.1', self.port), timeout=10)
        s.sendall(f'POST /api/odai HTTP/1.0\r\nContent-Length: {len(data)}\r\n\r\n'.encode())
        for i in range(0, len(data), 200):
            s.sendall(data[i:i + 200])
            time.sleep(0.6)
        buf = b''
        while True:
            c = s.recv(65536)
            if not c:
                break
            buf += c
        s.close()
        self.assertTrue(buf.startswith(b'HTTP/1.0 200'), buf[:40])


class BodyTest(Served):
    ROUTES = ('/api/jobs', '/api/legs', '/api/matrix', '/api/transit-shot', '/api/adjust', '/api/odai', '/api/bus-table', '/api/place-find', '/api/slope')

    def test_non_finite_numbers_are_bad_request(self):
        for raw in (b'{"points":[[35.0,139.0],[35.1,139.1]],"start":Infinity,"end":600}',
                    b'{"points":[[35.0,139.0],[35.1,139.1]],"start":1e999,"end":600}',
                    b'{"points":[[NaN,139.0],[35.1,139.1]],"start":0,"end":600}'):
            self.assertEqual(post(self.port, '/api/bus-table', raw), (400, {'error': 'bad'}), raw)
        self.assertEqual(post(self.port, '/api/legs', b'{"legs":[{"a":[NaN,35],"b":[139,35]}]}'), (400, {'error': 'bad'}))

    def test_body_must_be_an_object(self):
        for route in self.ROUTES:
            for raw in (b'[]', b'"x"', b'3', b'null'):
                self.assertEqual(post(self.port, route, raw), (400, {'error': 'bad'}), (route, raw))

    def test_broken_json_is_bad_request(self):
        for route in self.ROUTES:
            self.assertEqual(post(self.port, route, b'{"a":'), (400, {'error': 'bad'}), route)


class LlmPerClientTest(Served):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = app.CACHE, app.LLM_RATE
        app.CACHE = self.tmp.name

    def tearDown(self):
        app.CACHE, app.LLM_RATE = self.saved
        self.tmp.cleanup()

    def test_odai_has_its_own_per_client_limit(self):
        saved = app.ODAI_RATE
        app.LLM_RATE, app.ODAI_RATE = app.bus.Rate(1, 0), app.bus.Rate(2, 0)
        try:
            got = [post(self.port, '/api/odai', {'place': {'name': 'x'}})[1] for _ in range(2)]
            self.assertTrue(all('error' not in d for d in got), got)
            self.assertEqual(post(self.port, '/api/odai', {'place': {'name': 'x'}}), (200, {'error': 'quota'}))
            self.assertNotIn('error', post(self.port, '/api/adjust', {'request': '昼を長く'})[1])
            self.assertEqual(post(self.port, '/api/adjust', {'request': '昼を長く'}), (200, {'error': 'quota'}))
            self.assertNotIn('error', post(self.port, '/api/odai', {'place': {'name': 'x'}}, who='203.0.113.2')[1])
        finally:
            app.ODAI_RATE = saved

    def test_new_area_counts_each_gemini_call(self):
        app.LLM_RATE = app.bus.Rate(len(app.places.AREA_TASKS) + 2, 0)
        code, d = post(self.port, '/api/jobs', {'area': '試験の町1'})
        self.assertIn(code, (200, 202))
        self.assertNotEqual(d.get('error'), 'quota')
        self.assertEqual(post(self.port, '/api/jobs', {'area': '試験の町2'}),
                         (200, {'id': '', 'state': 'error', 'error': 'quota'}))

    def test_new_area_waits_when_gemini_hour_is_almost_used(self):
        saved = app.llm.per_hour, list(app.llm.times)
        app.LLM_RATE = app.bus.Rate(0, 0)
        try:
            app.llm.per_hour = 10
            app.llm.times = [app.time.time()] * (10 - len(app.places.AREA_TASKS) + 1)
            self.assertEqual(post(self.port, '/api/jobs', {'area': '試験の町3'}),
                             (200, {'id': '', 'state': 'error', 'error': 'quota'}))
            self.assertEqual(len(app.llm.times), 10 - len(app.places.AREA_TASKS) + 1)
            app.llm.times = [app.time.time()] * (10 - len(app.places.AREA_TASKS))
            code, d = post(self.port, '/api/jobs', {'area': '試験の町4'})
            self.assertNotEqual(d.get('error'), 'quota')
        finally:
            app.llm.per_hour, app.llm.times = saved

    def test_cached_area_without_wish_is_not_counted(self):
        app.LLM_RATE = app.bus.Rate(1, 0)
        app.LLM_RATE.take('203.0.113.1')
        akey = app.key_of('area', '作り置きの町')
        area = {'area': {'name': '作り置きの町', 'lat': 35.0, 'lng': 135.7, 'radius': 3}, 'start': {'name': '駅', 'lat': 35.0, 'lng': 135.7},
                'places': [], 'query': '作り置きの町'}
        with open(app.path_of('area', akey), 'w', encoding='utf-8') as f:
            json.dump(area, f, ensure_ascii=False)
        code, d = post(self.port, '/api/jobs', {'area': '作り置きの町'})
        self.assertNotEqual(d.get('error'), 'quota')
        self.assertEqual(post(self.port, '/api/jobs', {'area': '作り置きの町', 'wish': '静かな庭'})[1].get('error'), 'quota')


class LegsTest(Served):
    def setUp(self):
        self.calls = []
        self.saved = app.enrich.leg_line, app.LEGS, app.LEGS_PATH, app.LEGS_RATE
        self.tmp = tempfile.TemporaryDirectory()
        app.LEGS, app.LEGS_PATH = {}, os.path.join(self.tmp.name, 'legs.json')

        def fake(a, b, mode, cache):
            key = app.enrich.leg_key(a, b, mode)
            if key in cache:
                return cache[key]
            self.calls.append((a, b, mode))
            cache[key] = [a, b]
            return [a, b]
        app.enrich.leg_line = fake

    def tearDown(self):
        app.enrich.leg_line, app.LEGS, app.LEGS_PATH, app.LEGS_RATE = self.saved
        self.tmp.cleanup()

    def test_points_outside_japan_are_not_sent(self):
        legs = [{'a': [-0.1, 51.5], 'b': [-0.12, 51.51]},          # ロンドン
                {'a': [35.0, 139.0], 'b': [35.1, 139.1]},          # 緯度と経度が逆さま
                {'a': [135.77, 35.0], 'b': ['135.78', 35.01]},     # 文字の座標
                {'a': [135.77], 'b': [135.78, 35.01]},
                'x']
        self.assertEqual(post(self.port, '/api/legs', {'legs': legs}), (200, {'lines': [None] * 5}))
        self.assertEqual(self.calls, [])

    def test_points_in_japan_are_sent(self):
        code, d = post(self.port, '/api/legs', {'legs': [{'a': [135.77, 35.0], 'b': [135.78, 35.01], 'mode': 'walk'}]})
        self.assertEqual(code, 200)
        self.assertEqual(self.calls, [([135.77, 35.0], [135.78, 35.01], 'walk')])

    def test_new_legs_are_counted_per_client(self):
        app.LEGS_RATE = app.bus.Rate(3, 0)
        leg = lambda i: {'a': [135.70 + i / 1000, 35.0], 'b': [135.71, 35.01], 'mode': 'walk'}
        self.assertEqual(post(self.port, '/api/legs', {'legs': [leg(0), leg(1)]})[1]['lines'][1], [[135.701, 35.0], [135.71, 35.01]])
        self.assertEqual(post(self.port, '/api/legs', {'legs': [leg(0), leg(1)]})[0], 200)     # 作り置きは数えない
        self.assertEqual(len(self.calls), 2)
        d = post(self.port, '/api/legs', {'legs': [leg(0), leg(2), leg(3)]})[1]
        self.assertEqual(d['lines'][0], [[135.7, 35.0], [135.71, 35.01]])                       # 作り置きの分は返す
        self.assertEqual(d['lines'][1:], [None, None])
        self.assertEqual(len(self.calls), 2)
        self.assertIsNotNone(post(self.port, '/api/legs', {'legs': [leg(2)]}, who='203.0.113.5')[1]['lines'][0])

    def test_saved_only_when_a_leg_is_added(self):
        leg = {'a': [135.77, 35.0], 'b': [135.78, 35.01]}
        post(self.port, '/api/legs', {'legs': [leg]})
        self.assertTrue(os.path.exists(app.LEGS_PATH))
        os.remove(app.LEGS_PATH)
        post(self.port, '/api/legs', {'legs': [leg]})
        post(self.port, '/api/legs', {'legs': [{'a': [-0.1, 51.5], 'b': [-0.12, 51.51]}]})
        self.assertFalse(os.path.exists(app.LEGS_PATH))

    def test_legs_must_be_a_list(self):
        self.assertEqual(post(self.port, '/api/legs', {'legs': {'a': 1}}), (400, {'error': 'bad'}))
        self.assertEqual(post(self.port, '/api/legs', {}), (200, {'lines': []}))


class SlopeTest(Served):
    def setUp(self):
        self.calls = []
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (app.enrich.leg_line, app.elev.slope, app.LEGS, app.LEGS_PATH, app.SLOPE, app.SLOPE_PATH,
                      getattr(app, 'SLOPE_RATE', None))
        app.LEGS, app.LEGS_PATH = {}, os.path.join(self.tmp.name, 'legs.json')
        app.SLOPE, app.SLOPE_PATH = {}, os.path.join(self.tmp.name, 'slope.json')

        def line(a, b, mode, cache):
            key = app.enrich.leg_key(a, b, mode)
            if key not in cache:
                self.calls.append(('line', a, b))
                cache[key] = [a, b]
            return cache[key]

        def slope(ln):
            self.calls.append(('slope', ln[0]))
            return {'up': 25, 'down': 3, 'steepUp': True, 'steepDown': False, 'm': 400}
        app.enrich.leg_line, app.elev.slope = line, slope

    def tearDown(self):
        (app.enrich.leg_line, app.elev.slope, app.LEGS, app.LEGS_PATH, app.SLOPE, app.SLOPE_PATH, rate) = self.saved
        if rate is not None:
            app.SLOPE_RATE = rate
        self.tmp.cleanup()

    def test_points_outside_japan_are_not_sent(self):
        legs = [{'a': [-0.1, 51.5], 'b': [-0.12, 51.51]}, {'a': [35.0, 139.0], 'b': [35.1, 139.1]},
                {'a': [135.77, 35.0], 'b': ['135.78', 35.01]}, {'a': [135.77]}, 'x']
        self.assertEqual(post(self.port, '/api/slope', {'legs': legs}), (200, {'slopes': [{}] * 5}))
        self.assertEqual(self.calls, [])

    def test_points_in_japan_are_sent(self):
        code, d = post(self.port, '/api/slope', {'legs': [{'a': [135.77, 35.0], 'b': [135.78, 35.01]}]})
        self.assertEqual((code, d['slopes'][0]['up']), (200, 25))
        self.assertEqual([c[0] for c in self.calls], ['line', 'slope'])

    def test_saved_only_when_something_is_added(self):
        leg = {'a': [135.77, 35.0], 'b': [135.78, 35.01]}
        post(self.port, '/api/slope', {'legs': [leg]})
        self.assertTrue(os.path.exists(app.LEGS_PATH) and os.path.exists(app.SLOPE_PATH))
        os.remove(app.LEGS_PATH)
        os.remove(app.SLOPE_PATH)
        post(self.port, '/api/slope', {'legs': [leg]})
        post(self.port, '/api/slope', {'legs': [{'a': [-0.1, 51.5], 'b': [-0.12, 51.51]}]})
        self.assertFalse(os.path.exists(app.LEGS_PATH) or os.path.exists(app.SLOPE_PATH))
        app.LEGS[app.enrich.leg_key([135.75, 35.0], [135.76, 35.0], 'walk')] = [[135.75, 35.0], [135.76, 35.0]]
        post(self.port, '/api/slope', {'legs': [{'a': [135.75, 35.0], 'b': [135.76, 35.0]}]})
        self.assertEqual((os.path.exists(app.LEGS_PATH), os.path.exists(app.SLOPE_PATH)), (False, True))

    def test_new_legs_are_counted_per_client(self):
        app.SLOPE_RATE = app.bus.Rate(3, 0)
        leg = lambda i: {'a': [135.70 + i / 1000, 35.0], 'b': [135.71, 35.01]}
        d = post(self.port, '/api/slope', {'legs': [leg(0), leg(1)]})[1]
        self.assertEqual([x['up'] for x in d['slopes']], [25, 25])
        self.assertEqual(post(self.port, '/api/slope', {'legs': [leg(0), leg(1)]})[0], 200)
        d = post(self.port, '/api/slope', {'legs': [leg(0), leg(2), leg(3), {'a': [-0.1, 51.5], 'b': [-0.1, 51.6]}]})[1]
        self.assertEqual(d['slopes'][0]['up'], 25)
        self.assertEqual(d['slopes'][1:], [None, None, {}])
        self.assertEqual(sum(1 for c in self.calls if c[0] == 'slope'), 2)
        self.assertEqual(post(self.port, '/api/slope', {'legs': [leg(2)]}, who='203.0.113.5')[1]['slopes'][0]['up'], 25)

    def test_legs_must_be_a_list(self):
        self.assertEqual(post(self.port, '/api/slope', {'legs': {'a': 1}}), (400, {'error': 'bad'}))
        self.assertEqual(post(self.port, '/api/slope', {}), (200, {'slopes': []}))
        self.assertEqual(post(self.port, '/api/slope', b'{"legs":[{"a":[NaN,35],"b":[135,35]}]}'), (400, {'error': 'bad'}))


class MatrixApiTest(Served):
    def setUp(self):
        self.calls = []
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = app.CACHE, app.enrich.matrix, app.elev.heights, app.LEGS_RATE
        app.CACHE = self.tmp.name

        def matrix(pts):
            self.calls.append(len(pts))
            n = len(pts)
            return {'walk': [[1.0] * n for _ in pts], 'drive': [[1.0] * n for _ in pts], 'walkM': [[80] * n for _ in pts]}
        app.enrich.matrix = matrix
        app.elev.heights = lambda pts: [10.0] * len(pts)
        app.LEGS_RATE = app.bus.Rate(2 * app.MATRIX_COST, 0)

    def tearDown(self):
        app.CACHE, app.enrich.matrix, app.elev.heights, app.LEGS_RATE = self.saved
        self.tmp.cleanup()

    def test_points_are_checked(self):
        for body in ({}, {'points': {'a': 1}}, {'points': [[135.77, 35.0]]}, {'points': [[135.77, 35.0], [-0.1, 51.5]]},
                     {'points': [[135.77, 35.0], ['135.78', 35.0]]}, {'points': [[135.77, 35.0]] * (app.MATRIX_MAX + 1)}):
            self.assertEqual(post(self.port, '/api/matrix', body), (400, {'error': 'bad'}), body)
        self.assertEqual(self.calls, [])

    def test_table_is_made_once_and_counted_per_client(self):
        pts = lambda i: [[135.77, 35.0], [135.78 + i / 1000, 35.01], [135.79, 35.02]]
        code, d = post(self.port, '/api/matrix', {'points': pts(0)})
        self.assertEqual((code, d['matrix']['walkM'][0][1], d['matrix']['heights']), (200, 80, [10.0] * 3))
        self.assertEqual(post(self.port, '/api/matrix', {'points': pts(0)})[0], 200)
        self.assertEqual(self.calls, [3])
        self.assertEqual(post(self.port, '/api/matrix', {'points': pts(1)})[0], 200)
        self.assertEqual(post(self.port, '/api/matrix', {'points': pts(2)}), (429, {'error': 'busy'}))
        self.assertEqual(post(self.port, '/api/matrix', {'points': pts(0)})[0], 200)
        self.assertEqual(post(self.port, '/api/matrix', {'points': pts(2)}, who='203.0.113.9')[0], 200)
        self.assertEqual(self.calls, [3, 3, 3])


def get(port, path, who='203.0.113.1'):
    return request(port, f'GET {path} HTTP/1.0\r\nX-Forwarded-For: {who}'.encode())


class PlacesPerClientTest(Served):
    def setUp(self):
        g = app.gplaces
        self.saved = app.PLACES_RATE, g.enabled, g.details, g.photo_uri
        g.enabled = lambda: True
        g.details = lambda pid, lang='ja': {'rating': 4.0, 'count': 1, 'hours': [], 'mapsUri': '', 'photos': []}
        g.photo_uri = lambda name, w: 'https://example.com/photo'
        app.PLACES_RATE = app.bus.Rate(3, 0)

    def tearDown(self):
        g = app.gplaces
        app.PLACES_RATE, g.enabled, g.details, g.photo_uri = self.saved

    def test_place_find_shares_the_per_client_limit(self):
        saved = app.gplaces.find
        app.gplaces.find = lambda p, area: 'ChIJfound000000'
        body = {'place': {'name': '試験の寺', 'lat': 35.01, 'lng': 135.78}, 'area': {'name': '京都', 'lat': 35.0, 'lng': 135.77, 'radius': 5}}
        try:
            self.assertEqual(post(self.port, '/api/place-find', body), (200, {'placeId': 'ChIJfound000000'}))
            self.assertEqual(get(self.port, '/api/place/ChIJ0000000000')[0], 200)
            self.assertEqual(post(self.port, '/api/place-find', body)[0], 200)
            self.assertEqual(post(self.port, '/api/place-find', body), (503, {'error': 'unavailable'}))
            self.assertEqual(post(self.port, '/api/place-find', {**body, 'place': {**body['place'], 'lat': float('nan')}}), (400, {'error': 'bad'}))
            self.assertEqual(post(self.port, '/api/place-find', b'{"place": NaN}'), (400, {'error': 'bad'}))
            self.assertEqual(request(self.port, b'POST /api/place-find HTTP/1.0\r\nContent-Length: -5', b'{}'), (400, {'error': 'bad'}))
        finally:
            app.gplaces.find = saved

    def test_default_follows_the_hourly_limit(self):
        saved_env, saved_hour = os.environ.pop('ZT_PLACES_PER_CLIENT', None), app.gplaces.PER_HOUR
        try:
            for hour, want in ((60, 30), (150, 75), (300, 150), (12, 10), (0, 120)):
                app.gplaces.PER_HOUR = hour
                self.assertEqual(app.places_per_client(), want, hour)
            os.environ['ZT_PLACES_PER_CLIENT'] = '7'
            self.assertEqual(app.places_per_client(), 7)
        finally:
            app.gplaces.PER_HOUR = saved_hour
            os.environ.pop('ZT_PLACES_PER_CLIENT', None)
            if saved_env is not None:
                os.environ['ZT_PLACES_PER_CLIENT'] = saved_env

    def test_details_and_photos_share_the_per_client_limit(self):
        self.assertEqual(get(self.port, '/api/place/ChIJ0000000000')[0], 200)
        self.assertEqual(get(self.port, '/api/place/ChIJ0000000001')[0], 200)
        self.assertEqual(get(self.port, '/api/place-photo?name=x&w=400')[0], 302)
        self.assertEqual(get(self.port, '/api/place/ChIJ0000000002'), (503, {'error': 'unavailable'}))
        self.assertEqual(get(self.port, '/api/place-photo?name=x&w=400'), (503, {'error': 'unavailable'}))
        self.assertEqual(get(self.port, '/api/place/ChIJ0000000002', who='203.0.113.9')[0], 200)


IMAGE = 'data:image/png;base64,' + __import__('base64').b64encode(b'\x89PNG\r\n\x1a\n' + b'0' * 64).decode()


class TransitShotTest(Served):
    def setUp(self):
        self.saved = app.quota_ok, app.LLM_RATE
        app.LLM_RATE = app.bus.Rate(0, 0)

    def tearDown(self):
        app.quota_ok, app.LLM_RATE = self.saved

    def test_low_quota_is_checked_like_adjust_and_odai(self):
        app.quota_ok = lambda: False
        before = len(app.llm.mod.CALLS)
        self.assertEqual(post(self.port, '/api/transit-shot', {'image': IMAGE}), (200, {'error': 'quota'}))
        self.assertEqual(len(app.llm.mod.CALLS), before)


class TransitShotLimitTest(Served):
    def setUp(self):
        self.saved = app.quota_ok, app.LLM_RATE
        app.quota_ok = lambda: True
        app.LLM_RATE = app.bus.Rate(1, 0)

    def tearDown(self):
        app.quota_ok, app.LLM_RATE = self.saved

    def test_limit_is_checked_before_the_body_is_read(self):
        big = json.dumps({'image': IMAGE, 'pad': 'x' * (2 * 1024 * 1024)}).encode()
        self.assertNotEqual(post(self.port, '/api/transit-shot', {'image': IMAGE})[1].get('error'), 'quota')
        before = len(app.llm.mod.CALLS)
        self.assertEqual(post(self.port, '/api/transit-shot', big), (200, {'error': 'quota'}))
        self.assertEqual(len(app.llm.mod.CALLS), before)

    def test_only_two_screenshots_at_once(self):
        app.LLM_RATE = app.bus.Rate(0, 0)
        app.SHOT_SEM.acquire()
        app.SHOT_SEM.acquire()
        try:
            self.assertEqual(post(self.port, '/api/transit-shot', {'image': IMAGE}), (200, {'error': 'quota'}))
        finally:
            app.SHOT_SEM.release()
            app.SHOT_SEM.release()
        self.assertNotEqual(post(self.port, '/api/transit-shot', {'image': IMAGE})[1].get('error'), 'quota')

    def test_bad_body_is_still_rejected(self):
        app.LLM_RATE = app.bus.Rate(0, 0)
        self.assertEqual(post(self.port, '/api/transit-shot', b'[]'), (400, {'error': 'bad'}))
        self.assertEqual(post(self.port, '/api/transit-shot', {'image': 'data:text/plain;base64,AA'}), (400, {'error': 'image'}))


class TransitShotSlowTest(Served):
    def setUp(self):
        self.saved = app.quota_ok, app.LLM_RATE, app.SHOT_READ
        app.quota_ok = lambda: True
        app.SHOT_READ = 2

    def tearDown(self):
        app.quota_ok, app.LLM_RATE, app.SHOT_READ = self.saved

    def trickle(self, who, length=100000):
        s = socket.create_connection(('127.0.0.1', self.port), timeout=10)
        s.sendall(f'POST /api/transit-shot HTTP/1.0\r\nContent-Length: {length}\r\nX-Forwarded-For: {who}\r\n\r\n{{'.encode())
        return s

    def test_limited_client_cannot_hold_the_slots(self):
        import time
        app.LLM_RATE = app.bus.Rate(1, 0)
        app.LLM_RATE.take('203.0.113.66')
        slow = [self.trickle('203.0.113.66') for _ in range(2)]
        time.sleep(0.3)
        try:
            self.assertNotEqual(post(self.port, '/api/transit-shot', {'image': IMAGE}, who='203.0.113.67')[1].get('error'), 'quota')
        finally:
            for x in slow:
                x.close()

    def test_slow_body_is_cut_at_the_deadline(self):
        import time
        app.LLM_RATE = app.bus.Rate(0, 0)
        slow = [self.trickle(f'203.0.113.{70 + i}') for i in range(2)]
        time.sleep(0.3)
        try:
            self.assertEqual(post(self.port, '/api/transit-shot', {'image': IMAGE}, who='203.0.113.79')[1].get('error'), 'quota')
            for _ in range(10):
                for x in slow:
                    try:
                        x.sendall(b' ')
                    except OSError:
                        pass
                time.sleep(0.3)
            self.assertNotEqual(post(self.port, '/api/transit-shot', {'image': IMAGE}, who='203.0.113.79')[1].get('error'), 'quota')
        finally:
            for x in slow:
                x.close()


class BrokenStore:
    def enabled(self):
        return True

    def indexes(self, box, ymd, wait=25.0):
        raise ValueError("invalid literal for int() with base 10: 'uuid'")


class BusFailureTest(Served):
    def setUp(self):
        self.saved = app.BUS
        app.BUS = BrokenStore()

    def tearDown(self):
        app.BUS = self.saved

    def test_bus_info_answers_when_the_timetable_breaks(self):
        code, d = get(self.port, '/api/bus-info?date=2026-11-08&box=35.0,135.7,35.1,135.8')
        self.assertEqual((code, d.get('on'), d.get('error')), (200, False, 'failed'))

    def test_bus_table_answers_when_the_timetable_breaks(self):
        code, d = post(self.port, '/api/bus-table', {'points': [[35.0, 135.7], [35.1, 135.8]], 'date': '2026-11-08', 'start': 540, 'end': 1080})
        self.assertEqual((code, d), (200, {'error': 'failed'}))


class JobsTest(unittest.TestCase):
    def setUp(self):
        self.saved = dict(app.JOBS), app.JOB_MAX
        app.JOBS.clear()

    def tearDown(self):
        app.JOBS.clear()
        app.JOBS.update(self.saved[0])
        app.JOB_MAX = self.saved[1]

    def test_finished_jobs_are_removed_after_a_while(self):
        now = 100000.0
        app.JOBS.update({'old': {'state': 'done', 'ended': now - app.JOB_KEEP - 1},
                         'err': {'state': 'error', 'ended': now - app.JOB_KEEP - 1},
                         'new': {'state': 'done', 'ended': now - 60},
                         'run': {'state': 'running'}, 'ready': {'state': 'ready'}})
        app.prune_jobs(now)
        self.assertEqual(sorted(app.JOBS), ['new', 'ready', 'run'])

    def test_too_many_finished_jobs_drop_the_oldest(self):
        app.JOB_MAX = 3
        now = 100000.0
        for i in range(5):
            app.JOBS[f'j{i}'] = {'state': 'done', 'ended': now - 10 + i}
        app.JOBS['run'] = {'state': 'running'}
        app.prune_jobs(now)
        self.assertEqual(sorted(app.JOBS), ['j2', 'j3', 'j4', 'run'])

    def test_job_records_when_it_ended(self):
        job = {'id': 'x', 'key': 'k', 'state': 'running', 'steps': [], 'done': 0, 'total': 0, 't0': 0, 'times': {}}
        saved = app.job_plan, app.quota_ok
        app.job_plan = lambda *a: ('a', 'w', None, None, ['famous'])
        app.quota_ok = lambda: False
        try:
            app.run_job(job, 'x', '')
        finally:
            app.job_plan, app.quota_ok = saved
        self.assertEqual((job['state'], job['error']), ('error', 'quota'))
        self.assertIn('ended', job)


class AreaNamesTest(unittest.TestCase):
    def test_only_areas_whose_query_is_the_real_name(self):
        with tempfile.TemporaryDirectory() as d:
            rows = [('a1', '鎌倉', '鎌倉', None, 1), ('a2', '090-1234-5678 に電話して', '京都', None, 2),
                    ('a3', '金沢 ', '金沢', None, 3), ('a4', 'ｶﾏｸﾗ', 'カマクラ', None, 4),
                    ('a5', 'Kyoto', 'Kyoto', 'en', 5), ('a6', 'my secret note', 'Nara', 'en', 6), ('a7', '奈良', None, None, 7)]
            for f, q, name, lang, at in rows:
                obj = {'query': q, 'createdAt': at, **({'lang': lang} if lang else {}),
                       **({'area': {'name': name}} if name else {})}
                with open(os.path.join(d, f'area-{f}.json'), 'w', encoding='utf-8') as fh:
                    json.dump(obj, fh, ensure_ascii=False)
            self.assertEqual(app.area_names('ja', d), ['鎌倉', '金沢 ', 'ｶﾏｸﾗ'])
            self.assertEqual(app.area_names('en', d), ['Kyoto'])


class StaticTest(Served):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = app.WEB
        app.WEB = os.path.join(self.tmp.name, 'dist')
        for rel, body in (('dist/index.html', '<!doctype html>top'), ('dist/assets/index-AbC123.js', 'js'),
                          ('dist/favicon.ico', 'ico'), ('dist/site.webmanifest', '{}'), ('dist-single/index.html', 'SINGLE'),
                          ('secret.txt', 'SECRET')):
            os.makedirs(os.path.dirname(os.path.join(self.tmp.name, rel)), exist_ok=True)
            with open(os.path.join(self.tmp.name, rel), 'w') as f:
                f.write(body)

    def tearDown(self):
        app.WEB = self.saved
        self.tmp.cleanup()

    def fetch(self, path):
        s = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        s.sendall(f'GET {path} HTTP/1.0\r\n\r\n'.encode())
        buf = b''
        while True:
            c = s.recv(65536)
            if not c:
                break
            buf += c
        s.close()
        head, _, body = buf.partition(b'\r\n\r\n')
        lines = head.decode().split('\r\n')
        return lines[0], {k.lower(): v for k, _, v in (x.partition(': ') for x in lines[1:])}, body.decode()

    def test_only_hashed_assets_are_cached_for_long(self):
        cases = {'/': ('text/html; charset=utf-8', 'no-cache'), '/plan/x': ('text/html; charset=utf-8', 'no-cache'),
                 '/assets/index-AbC123.js': ('text/javascript', 'public, max-age=31536000, immutable'),
                 '/favicon.ico': ('image/x-icon', 'no-cache'), '/site.webmanifest': ('application/manifest+json', 'no-cache')}
        for path, want in cases.items():
            top, head, _ = self.fetch(path)
            self.assertEqual((top.split(' ')[1], head['content-type'], head['cache-control']), ('200', *want), path)

    def test_nosniff_on_every_answer(self):
        for path in ('/', '/assets/index-AbC123.js', '/api/health', '/api/jobs/nothing'):
            self.assertEqual(self.fetch(path)[1].get('x-content-type-options'), 'nosniff', path)
        s = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        s.sendall(b'PUT / HTTP/1.0\r\n\r\n')
        self.assertIn(b'nosniff', s.recv(4096))
        s.close()

    def test_security_headers_on_every_answer(self):
        want = {'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin', 'strict-transport-security': 'max-age=31536000'}
        for path in ('/', '/assets/index-AbC123.js', '/api/health', '/api/xxx'):
            head = self.fetch(path)[1]
            self.assertEqual({k: head.get(k) for k in want}, want, path)

    def test_unknown_api_is_json_404(self):
        for path in ('/api', '/api/', '/api/xxx', '/api/xxx/yyy?lang=ja'):
            top, head, body = self.fetch(path)
            self.assertEqual((top.split(' ')[1], head['content-type'], body), ('404', 'application/json; charset=utf-8', '{"error": "notfound"}'), path)
        self.assertEqual(self.fetch('/apiary')[2], '<!doctype html>top')

    def test_files_beside_dist_are_not_served(self):
        for p in ('/../dist-single/index.html', '/../secret.txt', '/%2e%2e/secret.txt'):
            self.assertEqual(self.fetch(p)[2], '<!doctype html>top', p)


class ClientKeyTest(Served):
    def test_ipv6_is_counted_per_64(self):
        self.assertEqual(app.client_key('2001:db8:1:2:aaaa::1'), app.client_key('2001:db8:1:2:ffff:1:2:3'))
        self.assertNotEqual(app.client_key('2001:db8:1:2::1'), app.client_key('2001:db8:1:3::1'))
        self.assertEqual(app.client_key('2001:db8:1:2::1'), '2001:db8:1:2::/64')
        self.assertEqual(app.client_key('203.0.113.5'), '203.0.113.5')
        self.assertEqual(app.client_key('::ffff:203.0.113.5'), '203.0.113.5')
        self.assertEqual(app.client_key('not-an-ip'), 'not-an-ip')

    def test_changing_the_ipv6_address_does_not_reset_the_limit(self):
        saved = app.ODAI_RATE
        app.ODAI_RATE = app.bus.Rate(3, 0)
        try:
            got = [post(self.port, '/api/odai', {'place': {'name': 'x'}}, who=f'2001:db8:5:6::{i:x}')[1] for i in range(5)]
        finally:
            app.ODAI_RATE = saved
        self.assertEqual([d.get('error') for d in got], [None, None, None, 'quota', 'quota'])


class ForwardedLinesTest(Served):
    def test_last_value_of_all_lines_is_used(self):
        saved = app.ODAI_RATE
        app.ODAI_RATE = app.bus.Rate(3, 0)
        data = json.dumps({'place': {'name': 'x'}}).encode()
        try:
            got = []
            for i in range(5):
                head = (f'POST /api/odai HTTP/1.0\r\nContent-Type: application/json\r\nX-Forwarded-For: 192.0.2.{i}\r\n'
                        f'X-Forwarded-For: 198.51.100.77\r\nContent-Length: {len(data)}').encode()
                got.append(request(self.port, head, data)[1])
        finally:
            app.ODAI_RATE = saved
        self.assertEqual([d.get('error') for d in got], [None, None, None, 'quota', 'quota'])


class ProxyHopsTest(Served):
    def odai_from(self, forwarded):
        data = json.dumps({'place': {'name': 'x'}}).encode()
        head = (f'POST /api/odai HTTP/1.0\r\nContent-Type: application/json\r\nX-Forwarded-For: {forwarded}\r\n'
                f'Content-Length: {len(data)}').encode()
        return request(self.port, head, data)[1]

    def test_direct_open_ignores_forwarded(self):
        saved = app.ODAI_RATE, app.PROXY_HOPS
        app.ODAI_RATE, app.PROXY_HOPS = app.bus.Rate(3, 0), 0
        try:
            got = [self.odai_from(f'192.0.2.{i}') for i in range(5)]
        finally:
            app.ODAI_RATE, app.PROXY_HOPS = saved
        self.assertEqual([d.get('error') for d in got], [None, None, None, 'quota', 'quota'])   # 書き換えても、同じ相手と数える

    def test_two_hops_uses_second_from_last(self):
        saved = app.ODAI_RATE, app.PROXY_HOPS
        app.ODAI_RATE, app.PROXY_HOPS = app.bus.Rate(3, 0), 2
        try:
            got = [self.odai_from(f'192.0.2.{i}, 198.51.100.7, 203.0.113.250') for i in range(5)]
            other = self.odai_from('198.51.100.8, 203.0.113.250')
            short = [self.odai_from('203.0.113.250') for _ in range(4)]
        finally:
            app.ODAI_RATE, app.PROXY_HOPS = saved
        self.assertEqual([d.get('error') for d in got], [None, None, None, 'quota', 'quota'])
        self.assertIsNone(other.get('error'))
        self.assertEqual([d.get('error') for d in short], [None, None, None, 'quota'])   # 足りなければ、つないできた相手

    def test_hops_from_env(self):
        self.assertEqual(app.proxy_hops({}), 0)
        self.assertEqual(app.proxy_hops({'K_SERVICE': 'intentrip'}), 1)
        self.assertEqual(app.proxy_hops({'K_SERVICE': 'intentrip', 'ZT_PROXY_HOPS': '2'}), 2)
        self.assertEqual(app.proxy_hops({'ZT_PROXY_HOPS': '0', 'K_SERVICE': 'x'}), 0)

class GzipTest(StaticTest):
    def setUp(self):
        super().setUp()
        with open(os.path.join(app.WEB, 'assets', 'index-AbC123.js'), 'w') as f:
            f.write('const x = "IntenTrip";\n' * 2000)

    def raw(self, path, accept=None, method='GET'):
        s = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        extra = f'Accept-Encoding: {accept}\r\n' if accept is not None else ''
        s.sendall(f'{method} {path} HTTP/1.0\r\n{extra}\r\n'.encode())
        buf = b''
        while True:
            c = s.recv(65536)
            if not c:
                break
            buf += c
        s.close()
        head, _, body = buf.partition(b'\r\n\r\n')
        lines = head.decode().split('\r\n')
        return lines[0], {k.lower(): v for k, _, v in (x.partition(': ') for x in lines[1:])}, body

    def test_js_is_gzipped_only_when_asked(self):
        import gzip
        _, h, body = self.raw('/assets/index-AbC123.js', 'gzip, deflate, br')
        self.assertEqual((h.get('content-encoding'), h.get('vary')), ('gzip', 'Accept-Encoding'))
        self.assertEqual(int(h['content-length']), len(body))
        self.assertEqual(gzip.decompress(body), b'const x = "IntenTrip";\n' * 2000)
        for accept in (None, 'identity', 'br', 'gzip;q=0'):
            _, h, body = self.raw('/assets/index-AbC123.js', accept)
            self.assertNotIn('content-encoding', h, accept)
            self.assertEqual(h.get('vary'), 'Accept-Encoding')
            self.assertEqual(len(body), len('const x = "IntenTrip";\n' * 2000))

    def test_compressed_file_is_kept_until_it_changes(self):
        import gzip
        self.raw('/assets/index-AbC123.js', 'gzip')
        path = os.path.realpath(os.path.join(app.WEB, 'assets', 'index-AbC123.js'))
        self.assertEqual(sum(1 for k in app.GZ if k[0] == path), 1)
        with open(path, 'w') as f:
            f.write('let y = 2;\n' * 300)
        _, _, body = self.raw('/assets/index-AbC123.js', 'gzip')
        self.assertEqual(gzip.decompress(body), b'let y = 2;\n' * 300)
        self.assertEqual(sum(1 for k in app.GZ if k[0] == path), 1)

    def test_small_and_binary_files_are_not_gzipped(self):
        _, h, _ = self.raw('/', 'gzip')
        self.assertNotIn('content-encoding', h)
        _, h, _ = self.raw('/favicon.ico', 'gzip')
        self.assertNotIn('content-encoding', h)

    def test_large_json_is_gzipped(self):
        import gzip
        _, h, body = self.raw('/api/sample', 'gzip')
        self.assertEqual(h.get('content-encoding'), 'gzip')
        self.assertIn('places', json.loads(gzip.decompress(body)))
        _, h, _ = self.raw('/api/health', 'gzip')
        self.assertNotIn('content-encoding', h)
        _, h, body = self.raw('/api/sample')
        self.assertNotIn('content-encoding', h)
        self.assertIn('places', json.loads(body))


class HeadTest(GzipTest):
    def test_head_has_the_same_headers_without_a_body(self):
        for path, accept in (('/', None), ('/assets/index-AbC123.js', 'gzip'), ('/assets/index-AbC123.js', None),
                             ('/api/sample', 'gzip'), ('/api/health', None)):
            top_g, h_g, body_g = self.raw(path, accept)
            top_h, h_h, body_h = self.raw(path, accept, method='HEAD')
            self.assertEqual((top_h, body_h), (top_g, b''), path)
            for k in ('content-type', 'content-length', 'content-encoding', 'cache-control', 'vary'):
                self.assertEqual(h_h.get(k), h_g.get(k), (path, k))

    def test_head_does_not_call_out(self):
        for path in ('/api/place/ChIJ0000000000', '/api/place-photo?name=x', '/api/bus-info', '/api/jobs/x'):
            top, _, body = self.raw(path, method='HEAD')
            self.assertEqual((top.split(' ')[1], body), ('405', b''), path)


class LimitedTest(unittest.TestCase):
    def test_room_counts_hour_and_day(self):
        import fake_llm
        lim = app.Limited(fake_llm, 3, 5)
        self.assertEqual(lim.room(), 3)
        lim.ask('a', '')
        self.assertEqual(lim.room(), 2)
        lim.day = [app.time.time()] * 5
        self.assertEqual(lim.room(), 0)
        self.assertEqual(app.Limited(fake_llm, 0, 0).room(), app.math.inf)

    def test_per_day_limit(self):
        import fake_llm
        lim = app.Limited(fake_llm, 0, 2)
        lim.ask('a')
        lim.ask('b')
        with self.assertRaises(RuntimeError) as e:
            lim.ask('c')
        self.assertIn('枠', str(e.exception))

    def test_per_hour_still_applies(self):
        import fake_llm
        lim = app.Limited(fake_llm, 1, 10)
        lim.ask('a')
        with self.assertRaises(RuntimeError):
            lim.ask('b')

    def test_zero_means_no_limit(self):
        import fake_llm
        lim = app.Limited(fake_llm, 0, 0)
        for _ in range(5):
            lim.ask('a')


    def test_retries_inside_are_counted(self):
        import types
        mod = types.SimpleNamespace(before_send=None)

        def ask(prompt, model=''):
            for _ in range(3):                    # 429 で 2 回やり直したときのように、3 回送る
                mod.before_send()
            return '{}'
        mod.ask = ask
        lim = app.Limited(mod, 5, 0)
        lim.ask('a')
        self.assertEqual(len(lim.times), 3)
        with self.assertRaises(RuntimeError) as e:
            lim.ask('b')
        self.assertIn('枠', str(e.exception))
        self.assertEqual(len(lim.times), 5)


class GeminiRetryTest(unittest.TestCase):
    """gemini.py の 429 のやり直しも、Limited の数に入る（google-genai は作り物）"""

    def test_each_try_is_counted(self):
        import types
        fake = {n: types.ModuleType(n) for n in ('google', 'google.genai', 'google.genai.errors')}

        class APIError(Exception):
            def __init__(self, code):
                super().__init__(code)
                self.code = code
        fake['google.genai.errors'].APIError = APIError
        fake['google.genai'].errors = fake['google.genai.errors']
        fake['google'].genai = fake['google.genai']
        saved_mods = {n: sys.modules.get(n) for n in fake}
        sys.modules.update(fake)
        import gemini
        tries = []

        class Models:
            def generate_content(self, **kw):
                tries.append(1)
                if len(tries) < 3:
                    raise APIError(429)
                return types.SimpleNamespace(text='{}')
        saved = (gemini._client, gemini.RETRY_WAITS, gemini.before_send, gemini._config)
        gemini._client, gemini.RETRY_WAITS = types.SimpleNamespace(models=Models()), (0, 0, 0)
        gemini._config = lambda t: None
        try:
            lim = app.Limited(gemini, 10, 0)
            self.assertEqual(lim.ask('a', 'm'), '{}')
            self.assertEqual((len(tries), len(lim.times)), (3, 3))
            lim2 = app.Limited(gemini, 4, 0)
            tries.clear()
            lim2.ask('a', 'm')
            tries.clear()
            with self.assertRaises(RuntimeError):     # 残り 1 回で、やり直しの途中で上限に届く
                lim2.ask('b', 'm')
            self.assertEqual(len(tries), 1)
        finally:
            gemini._client, gemini.RETRY_WAITS, gemini.before_send, gemini._config = saved
            for n, m in saved_mods.items():
                if m is None:
                    sys.modules.pop(n, None)
                else:
                    sys.modules[n] = m

if __name__ == '__main__':
    unittest.main()
