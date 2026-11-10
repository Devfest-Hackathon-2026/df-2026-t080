# 出発地・到着地に書いた文字を地図のデータ（Nominatim）で引く係と受け口の試験。
# cd server && python3 -m unittest discover -s tests
import os, sys, tempfile, unittest
from unittest import mock
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
from test_guard import Served, request  # noqa: E402
import app  # noqa: E402
import places  # noqa: E402


def hit(cat, typ, name, lat, lng, en=None, code='JP-13', city='千代田区'):
    return {'category': cat, 'type': typ, 'name': name, 'lat': str(lat), 'lon': str(lng),
            'namedetails': {'name': name, 'name:ja': name, **({'name:en': en} if en else {})},
            'address': {'city': city, 'ISO3166-2-lvl4': code}}


class GeocodeTest(unittest.TestCase):
    def run_with(self, answers, q, lang='ja'):
        asked = []

        def fake(params):
            asked.append(params['q'])
            return answers.get(params['q'], [])
        with mock.patch.object(places, '_search', fake):
            cache = {}
            return places.geocode(q, lang, cache), asked, cache

    def test_station_first(self):
        # 本物の返事の形: 「市ヶ谷駅」は交差点の名前が先に来る
        got, asked, _ = self.run_with({'市ヶ谷駅': [hit('junction', 'yes', '市ヶ谷駅', 35.6911, 139.7359),
                                                 hit('railway', 'stop', '市ヶ谷駅', 35.6932, 139.7368, 'Ichigaya', city='新宿区')]}, '市ヶ谷駅')
        self.assertEqual((got['name'], got['lat'], got['pref'], got['city']), ('市ヶ谷駅', 35.6932, '東京都', '新宿区'))
        self.assertEqual(asked, ['市ヶ谷駅'])

    def test_place_name_tries_station(self):
        got, asked, _ = self.run_with({'市ヶ谷': [hit('place', 'quarter', '市谷', 35.69, 139.73)],
                                       '市ヶ谷駅': [hit('railway', 'station', '市ヶ谷駅', 35.6932, 139.7368)]}, '市ヶ谷')
        self.assertEqual(got['name'], '市ヶ谷駅')
        self.assertEqual(asked, ['市ヶ谷', '市ヶ谷駅'])

    def test_station_name_without_eki(self):
        got, _, _ = self.run_with({'京都': [hit('railway', 'station', '京都', 34.9853, 135.7587, 'Kyoto', code='JP-26', city='京都市')]}, '京都')
        self.assertEqual((got['name'], got['pref']), ('京都駅', '京都府'))
        en, _, _ = self.run_with({'京都': [hit('railway', 'station', '京都', 34.9853, 135.7587, 'Kyoto', code='JP-26', city='京都市')]}, '京都', 'en')
        self.assertEqual((en['name'], en['ja'], en['pref']), ('Kyoto Station', '京都駅', 'Kyoto'))

    def test_hotel_is_kept(self):
        got, asked, _ = self.run_with({'ホテル京都': [hit('tourism', 'hotel', 'ホテル京都', 35.0, 135.76, code='JP-26', city='京都市')]}, 'ホテル京都')
        self.assertEqual(got['name'], 'ホテル京都')
        self.assertEqual(asked, ['ホテル京都'])

    def test_not_found_is_remembered(self):
        got, asked, cache = self.run_with({}, '架空の町')
        self.assertIsNone(got)
        self.assertEqual(cache, {places.find_key('ja', '架空の町'): {}})
        with mock.patch.object(places, '_search', side_effect=AssertionError('呼ばない')):
            self.assertIsNone(places.geocode('架空の町', 'ja', cache))

    def test_outside_japan_is_skipped(self):
        got, _, _ = self.run_with({'パリ': [hit('place', 'city', 'Paris', 48.85, 2.35)]}, 'パリ')
        self.assertIsNone(got)

    def test_prefecture_station_outside_looks_inside(self):
        # 本物の返事の形: 「福岡駅」で返るのは富山県高岡市の福岡駅だけ。福岡県の中の駅は無いので、福岡市にする
        toyama = hit('railway', 'station', '福岡駅', 36.7165, 136.9497, 'Fukuoka', code='JP-16', city='高岡市')
        city = hit('boundary', 'administrative', '福岡市', 33.5902, 130.4017, 'Fukuoka', code='JP-40', city='福岡市')
        answers = {'福岡駅': [toyama], 'Fukuoka Station': [toyama], '福岡市 福岡駅': [toyama], '福岡市': [city]}
        got, asked, cache = self.run_with(answers, '福岡駅')
        self.assertEqual((got['name'], got['pref'], got['lat']), ('福岡市', '福岡県', 33.5902))
        self.assertEqual(asked, ['福岡駅', '福岡市 福岡駅', '福岡市'])
        self.assertEqual(list(cache), [places.find_key('ja', '福岡駅')])
        en, asked, _ = self.run_with(answers, 'Fukuoka Station', 'en')
        self.assertEqual((en['name'], en['ja'], en['pref']), ('Fukuoka', '福岡市', 'Fukuoka'))
        self.assertEqual(asked, ['Fukuoka Station', '福岡市 福岡駅', '福岡市'])

    def test_prefecture_station_inside_is_kept(self):
        # 福島駅は大阪府にもある。福島県の駅が返れば、並びが後でもそちらにする（問い合わせは増やさない）
        osaka = hit('railway', 'station', '福島駅', 34.6973, 135.4867, 'Fukushima', code='JP-27', city='大阪市')
        fuku = hit('railway', 'station', '福島駅', 37.7541, 140.4597, 'Fukushima', code='JP-07', city='福島市')
        got, asked, _ = self.run_with({'福島駅': [osaka, fuku]}, '福島駅')
        self.assertEqual((got['pref'], got['city']), ('福島県', '福島市'))
        self.assertEqual(asked, ['福島駅'])
        # 本物の返事の形: 「福島駅」で福島県の駅が返らないときは、「福島市 福島駅」の駅舎（building）にする
        hall = hit('building', 'train_station', '福島駅', 37.7551, 140.4587, code='JP-07', city='福島市')
        got, asked, _ = self.run_with({'福島駅': [osaka], '福島市 福島駅': [hall]}, '福島駅')
        self.assertEqual((got['name'], got['pref'], got['lat']), ('福島駅', '福島県', 37.7551))
        self.assertEqual(asked, ['福島駅', '福島市 福島駅'])
        for q, code, pref in (('京都駅', 'JP-26', '京都府'), ('大阪駅', 'JP-27', '大阪府')):
            got, asked, _ = self.run_with({q: [hit('railway', 'station', q, 34.7, 135.5, code=code)]}, q)
            self.assertEqual((got['name'], got['pref']), (q, pref))
            self.assertEqual(asked, [q])

    def test_prefecture_station_keeps_pick_when_nothing_inside(self):
        far = hit('railway', 'station', '群馬駅', 36.0, 139.0, code='JP-13')
        got, asked, _ = self.run_with({'群馬駅': [far]}, '群馬駅')
        self.assertEqual(got['pref'], '東京都')
        self.assertEqual(asked, ['群馬駅', '群馬市 群馬駅', '群馬市'])

    def test_prefecture_written_first(self):
        # 「福岡県 福岡駅」と都道府県名を書き足したときも、県の中を探す。「大阪府 福島駅」は大阪の駅のまま
        toyama = hit('railway', 'station', '福岡駅', 36.7165, 136.9497, code='JP-16', city='高岡市')
        city = hit('boundary', 'administrative', '福岡市', 33.5902, 130.4017, code='JP-40', city='福岡市')
        got, asked, _ = self.run_with({'福岡県 福岡駅': [], '福岡市': [city]}, '福岡県 福岡駅')
        self.assertEqual((got['name'], got['pref']), ('福岡市', '福岡県'))
        self.assertEqual(asked, ['福岡県 福岡駅', '福岡市 福岡駅', '福岡市'])
        got, _, _ = self.run_with({'福岡県 福岡駅': [toyama], '福岡市': [city]}, '福岡県 福岡駅')
        self.assertEqual(got['pref'], '福岡県')
        osaka = hit('railway', 'station', '福島駅', 34.6973, 135.4867, code='JP-27', city='大阪市')
        got, asked, _ = self.run_with({'大阪府 福島駅': [osaka]}, '大阪府 福島駅')
        self.assertEqual((got['pref'], got['city']), ('大阪府', '大阪市'))
        self.assertEqual(asked, ['大阪府 福島駅'])
        self.assertEqual(places.pref_head('福岡県福岡駅'), (40, '福岡駅'))
        self.assertEqual(places.pref_head('Osaka Fukushima Station'), (27, 'Fukushima Station'))
        self.assertEqual(places.pref_head('福岡県'), (0, ''))

    def test_prefecture_lookup_failure_keeps_first_pick(self):
        # 県の中を探し直す途中で地図のデータが答えないときは、最初に見つけた場所を返し、取っておかない（次に探し直す）
        toyama = hit('railway', 'station', '福岡駅', 36.7165, 136.9497, code='JP-16', city='高岡市')

        def fake(params):
            return [toyama] if params['q'] == '福岡駅' else None
        cache = {}
        with mock.patch.object(places, '_search', fake):
            got = places.geocode('福岡駅', 'ja', cache)
        self.assertEqual(got['pref'], '富山県')
        self.assertEqual(cache, {})

    def test_weak_match_is_not_found(self):
        # 意味のない文字に、Nominatim が似た読みの別の場所を返しても、見つからなかったことにする
        nagoya = hit('boundary', 'administrative', '名古屋市', 35.18, 136.90, 'Nagoya', code='JP-23', city='名古屋市')
        nagoya['namedetails']['name:ja-Hira'] = 'なごやし'
        aichi = hit('boundary', 'administrative', '愛知県', 35.0, 137.0, 'Aichi', code='JP-23', city='')
        aichi['namedetails']['name:ja-Hira'] = 'あいちけん'
        got, _, cache = self.run_with({'あいうえお': [nagoya, aichi], 'あいうえお駅': [aichi]}, 'あいうえお')
        self.assertIsNone(got)
        self.assertEqual(cache, {places.find_key('ja', 'あいうえお'): {}})

    def test_same_name_far_apart_is_not_found(self):
        # 各地にある同じ名前の店は、どれか決められないので見つからなかったことにする（都道府県名を足してもらう）
        pubs = [hit('amenity', 'pub', 'あいうえお', 35.17, 136.91, code='JP-23', city='名古屋市'),
                hit('amenity', 'cafe', 'あいうえお', 34.69, 135.50, code='JP-27', city='大阪市')]
        got, _, _ = self.run_with({'あいうえお': pubs}, 'あいうえお')
        self.assertIsNone(got)
        nara = [{**hit('leisure', 'park', '奈良公園', 34.685, 135.843, 'Nara Park', code='JP-29', city='奈良市'), 'importance': 0.4},
                {**hit('leisure', 'park', '奈良公園', 35.0, 136.0, code='JP-25', city='大津市'), 'importance': 0.01}]
        got, _, _ = self.run_with({'奈良公園': nara}, '奈良公園')
        self.assertEqual(got['city'], '奈良市')
        near = [pubs[0], hit('amenity', 'pub', 'あいうえお', 35.171, 136.911, code='JP-23', city='名古屋市')]
        got, _, _ = self.run_with({'あいうえお': near}, 'あいうえお')
        self.assertEqual(got['city'], '名古屋市')

    def test_prefecture_with_unknown_place_is_not_found(self):
        # 都道府県名のあとに書いた場所が何にも当たらないときは、その都道府県の市で代えない
        tokyo = hit('boundary', 'administrative', '東京', 35.68, 139.69, 'Tokyo', code='JP-13', city='')
        got, asked, _ = self.run_with({'東京市': [tokyo]}, '東京都 あいうえお')
        self.assertIsNone(got)
        self.assertNotIn('東京市', asked)

    def test_reading_and_other_names_match(self):
        kamakura = hit('railway', 'station', '鎌倉', 35.319, 139.550, 'Kamakura', code='JP-14', city='鎌倉市')
        kamakura['namedetails']['name:ja-Hira'] = 'かまくら'
        for q in ('カマクラ', 'kamakura', '鎌倉駅', 'Kamakura Station'):
            got, _, _ = self.run_with({q: [kamakura]}, q)
            self.assertEqual(got and got['name'], '鎌倉駅', q)

    def test_pref_named(self):
        self.assertEqual([places.pref_named(t) for t in ('福岡駅', 'Fukuoka Station', '福岡', '京都駅', '北海道', '博多駅', '福岡市')],
                         [40, 40, 40, 26, 1, 0, 0])

    def test_failure_is_not_remembered(self):
        cache = {}
        with mock.patch.object(places, '_search', return_value=None):
            with self.assertRaises(places.GeoBusy):
                places.geocode('飯田橋', 'ja', cache)
        self.assertEqual(cache, {})


class GeocodeServedTest(Served):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.geo_path = os.path.join(self.dir.name, 'geo.json')

    def tearDown(self):
        self.dir.cleanup()

    def test_geocode(self):
        found = {'name': '飯田橋駅', 'pref': '東京都', 'city': '千代田区', 'lat': 35.7, 'lng': 139.74}
        with mock.patch.object(app, 'GEO', {}), mock.patch.object(app, 'GEO_PATH', self.geo_path), \
                mock.patch.object(places, 'geocode', side_effect=lambda q, lang, c: c.update({places.find_key(lang, q): found}) or found) as g:
            path = f'/api/geocode?q={quote("飯田橋")}&lang=ja'.encode()
            code, d = request(self.port, b'GET ' + path + b' HTTP/1.0')
            self.assertEqual((code, d['name']), (200, '飯田橋駅'))
            code, d = request(self.port, b'GET ' + path + b' HTTP/1.0')
            self.assertEqual((code, g.call_count), (200, 1))
        with mock.patch.object(app, 'GEO', {}), mock.patch.object(places, 'geocode', return_value=None), \
                mock.patch.object(app, 'GEO_PATH', self.geo_path):
            code, d = request(self.port, f'GET /api/geocode?q={quote("架空の町")} HTTP/1.0'.encode())
            self.assertEqual((code, d['error']), (404, 'notfound'))
        with mock.patch.object(app, 'GEO', {}), mock.patch.object(places, 'geocode', side_effect=places.GeoBusy('x')):
            code, d = request(self.port, f'GET /api/geocode?q={quote("どこか")} HTTP/1.0'.encode())
            self.assertEqual(code, 503)
        code, _ = request(self.port, b'GET /api/geocode?q= HTTP/1.0')
        self.assertEqual(code, 400)

    def test_geocode_head_is_refused(self):
        code, _ = request(self.port, f'HEAD /api/geocode?q={quote("京都")} HTTP/1.0'.encode())
        self.assertEqual(code, 405)


class RefusedTest(unittest.TestCase):
    """地図のデータに断られた（429）ら、しばらく問い合わせない（同じ住所からの頼みを増やさない）"""

    def tearDown(self):
        places._pause[0] = 0.0

    def test_pause_after_429(self):
        import io, urllib.error
        calls = []

        def refuse(req, timeout=0):
            calls.append(req.full_url)
            raise urllib.error.HTTPError(req.full_url, 429, 'Too Many Requests', {}, io.BytesIO(b''))
        with mock.patch.object(places.urllib.request, 'urlopen', refuse), mock.patch.object(places, '_last', [0.0]):
            with self.assertRaises(places.GeoBusy):
                places.geocode('蔵前', 'ja', {})
            self.assertIsNone(places.nominatim('浅草寺', (35.6, 139.7, 35.8, 139.9), {}))
        self.assertEqual(len(calls), 1)
        self.assertGreater(places._pause[0], 0)


if __name__ == '__main__':
    unittest.main()
