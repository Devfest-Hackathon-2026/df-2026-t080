# 「この付近で検索」（POST /api/area-search と gplaces.area_search）の試験。本物の Places は呼ばない
import json, os, socket, sys, threading, time, unittest
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
os.environ['ZT_RAIL'] = '0'
os.environ.setdefault('ZT_LLM_MODULE', os.path.join(HERE, 'fake_llm.py'))
import bus, gplaces  # noqa: E402
import app  # noqa: E402

BOX = [35.00, 135.76, 35.01, 135.78]


def call(port, body):
    data = json.dumps(body).encode()
    head = f'POST /api/area-search HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: {len(data)}\r\n\r\n'.encode()
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


class AreaSearchTest(unittest.TestCase):
    def setUp(self):
        self.saved = (gplaces._call, gplaces.AREA_PER_DAY, gplaces._times[:], gplaces._area_times[:])
        gplaces._area_times.clear()
        self.asked = []

    def tearDown(self):
        gplaces._call, gplaces.AREA_PER_DAY = self.saved[0], self.saved[1]
        gplaces._times[:], gplaces._area_times[:] = self.saved[2], self.saved[3]

    def test_asks_only_inside_the_box_and_reads_the_answer(self):
        def fake(kind, path, query=None, body=None, fields=''):
            self.asked.append((kind, path, body, fields))
            return {'places': [
                {'id': 'ChIJ' + 'a' * 20, 'displayName': {'text': '喫茶 みなみ'}, 'location': {'latitude': 35.005, 'longitude': 135.77},
                 'primaryType': 'coffee_shop', 'primaryTypeDisplayName': {'text': 'カフェ'}, 'rating': 4.3, 'userRatingCount': 120,
                 'regularOpeningHours': {'periods': [{'open': {'day': 6, 'hour': 8, 'minute': 30}, 'close': {'day': 6, 'hour': 17, 'minute': 0}},
                                                     {'open': {'day': 5, 'hour': 18}, 'close': {'day': 6, 'hour': 1}}]}},
                {'id': 'ChIJ' + 'b' * 20, 'displayName': {'text': '位置の無い店'}},
            ]}
        gplaces._call = fake
        got = gplaces.area_search('カフェ', (35.0, 135.76, 35.01, 135.78), 'en')
        kind, path, body, fields = self.asked[0]
        self.assertEqual((kind, path), ('area', 'places:searchText'))
        self.assertEqual(body['locationRestriction']['rectangle'],
                         {'low': {'latitude': 35.0, 'longitude': 135.76}, 'high': {'latitude': 35.01, 'longitude': 135.78}})
        self.assertNotIn('locationBias', body)
        self.assertEqual(body['languageCode'], 'en')
        self.assertNotIn('photos', fields)
        self.assertNotIn('currentOpeningHours', fields)
        self.assertEqual(got, [{'id': 'ChIJ' + 'a' * 20, 'name': '喫茶 みなみ', 'lat': 35.005, 'lng': 135.77, 'type': 'カフェ', 'kind': 'cafe',
                                'rating': 4.3, 'count': 120, 'hours': [[6, 510, 6, 1020], [5, 1080, 6, 60]]}])

    def test_details_give_name_position_and_hours(self):
        gplaces._call = lambda kind, path, query=None, body=None, fields='': {
            'displayName': {'text': '喫茶 みなみ'}, 'location': {'latitude': 35.005, 'longitude': 135.77}, 'primaryType': 'cafe',
            'regularOpeningHours': {'weekdayDescriptions': [f'{d}曜日: 8時30分～17時00分' for d in '月火水木金土日'],
                                    'periods': [{'open': {'day': d, 'hour': 8, 'minute': 30}, 'close': {'day': d, 'hour': 17}} for d in range(7)]}}
        d = gplaces.details('ChIJ' + 'a' * 20)
        self.assertEqual((d['name'], d['lat'], d['lng'], d['kind']), ('喫茶 みなみ', 35.005, 135.77, 'cafe'))
        self.assertEqual(d['periods'][0], [0, 510, 0, 1020])
        self.assertEqual(d['hours'][0], {'day': '月曜日', 'text': '8:30〜17:00'})

    def test_kinds_and_hours(self):
        self.assertEqual([gplaces.kind_of(t) for t in ('ramen_restaurant', 'restaurant', 'cafe', 'dessert_shop', 'gift_shop', 'market', 'buddhist_temple', None)],
                         ['food', 'food', 'cafe', 'cafe', 'street', 'street', 'sight', 'sight'])
        self.assertEqual(gplaces.periods_of({'periods': [{'open': {'day': 0, 'hour': 0, 'minute': 0}}]}), [[0, 0, None, None]])
        self.assertIsNone(gplaces.periods_of({}))
        self.assertIsNone(gplaces.periods_of(None))

    def test_rejected_request_is_a_failure_not_an_empty_answer(self):
        gplaces._call = lambda *a, **k: None
        with self.assertRaises(gplaces.Off):
            gplaces.area_search('カフェ', (35.0, 135.76, 35.01, 135.78))
        gplaces._call = lambda *a, **k: {}
        self.assertEqual(gplaces.area_search('カフェ', (35.0, 135.76, 35.01, 135.78)), [])

    def test_area_has_its_own_daily_limit(self):
        gplaces.AREA_PER_DAY = 2
        before = len(gplaces._times)
        self.assertTrue(gplaces._take_area())
        self.assertTrue(gplaces._take_area())
        self.assertFalse(gplaces._take_area())
        self.assertEqual(len(gplaces._times), before)
        gplaces._area_times[:] = [time.time() - 90000] * 2
        self.assertTrue(gplaces._take_area())


class AreaSearchApiTest(unittest.TestCase):
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
        self.saved = (gplaces.enabled, gplaces.area_search, app.AREA_RATE)
        gplaces.enabled = lambda: True
        self.asked = []
        gplaces.area_search = lambda q, box, lang='ja': self.asked.append((q, box, lang)) or [{'id': 'x', 'name': 'n'}]
        app.AREA_RATE = bus.Rate(0, 0)

    def tearDown(self):
        gplaces.enabled, gplaces.area_search, app.AREA_RATE = self.saved

    def test_ok(self):
        code, d = call(self.port, {'q': '  ラーメン   屋 ', 'box': BOX, 'lang': 'en'})
        self.assertEqual((code, d), (200, {'places': [{'id': 'x', 'name': 'n'}]}))
        self.assertEqual(self.asked, [('ラーメン 屋', (35.0, 135.76, 35.01, 135.78), 'en')])

    def test_bad_and_wide(self):
        self.assertEqual(call(self.port, {'q': '', 'box': BOX})[0], 400)
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': [1, 2, 3]})[0], 400)
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': [35.01, 135.76, 35.0, 135.78]})[0], 400)
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': [40.0, -74.0, 40.1, -73.9]})[0], 400)
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': [34.6, 135.4, 35.0, 135.8]}), (400, {'error': 'wide'}))
        self.assertEqual(self.asked, [])

    def test_limits(self):
        app.AREA_RATE = bus.Rate(1, 0)
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': BOX})[0], 200)
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': BOX}), (503, {'error': 'limit'}))

        def off(q, box, lang='ja'):
            raise gplaces.Off('limit')
        app.AREA_RATE = bus.Rate(0, 0)
        gplaces.area_search = off
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': BOX}), (503, {'error': 'limit'}))
        gplaces.enabled = lambda: False
        self.assertEqual(call(self.port, {'q': 'カフェ', 'box': BOX}), (503, {'error': 'off'}))


if __name__ == '__main__':
    unittest.main()
