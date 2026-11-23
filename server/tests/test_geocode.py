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

    def test_station_found_by_spaced_name(self):
        # 本物の返事の形: 「仙台駅」は名前が「仙台」の駅が当たらず別の店だけ、「東京駅」は「東京駅(改札外)」の通路だけが返る。
        # 「仙台 駅」「東京 駅」なら駅だけが返る
        sushi = hit('amenity', 'restaurant', '仙太鮨', 34.4688, 133.8211, code='JP-33', city='倉敷市')
        sendai = hit('railway', 'station', '仙台', 38.2603516, 140.8823921, 'Sendai', code='JP-04', city='仙台市')
        got, asked, _ = self.run_with({'仙台駅': [sushi], '仙台 駅': [sendai]}, '仙台駅')
        self.assertEqual((got['name'], got['pref'], got['lat']), ('仙台駅', '宮城県', 38.260352))
        self.assertEqual(asked, ['仙台駅', '仙台 駅'])
        path = hit('highway', 'footway', '東京駅(改札外)', 35.6812767, 139.7644712, code='JP-13', city='千代田区')
        tokyo = hit('railway', 'station', '東京', 35.6812546, 139.766706, 'Tōkyō', code='JP-13', city='千代田区')
        got, asked, _ = self.run_with({'東京駅': [path], '東京 駅': [tokyo]}, '東京駅')
        self.assertEqual((got['name'], got['lat']), ('東京駅', 35.681255))
        self.assertEqual(asked, ['東京駅', '東京 駅'])
        # 那覇空港駅は英語でも駅（Naha Airport）にする。1 件目は貸し自転車の「那覇空港駅」
        bike = hit('amenity', 'bicycle_rental', '那覇空港駅', 26.2062943, 127.6521719, code='JP-47', city='Naha')
        naha = hit('railway', 'station', '那覇空港', 26.2064858, 127.6522133, 'Naha Airport', code='JP-47', city='Naha')
        en, asked, _ = self.run_with({'那覇空港駅': [bike], '那覇空港 駅': [naha]}, '那覇空港駅', 'en')
        self.assertEqual((en['name'], en['ja'], en['pref']), ('Naha Airport Station', '那覇空港駅', 'Okinawa'))
        # 都道府県の名前だけのときも、玄関口の駅をこの形で引く
        town = hit('place', 'neighbourhood', '宮城', 35.7598, 139.7549, code='JP-13', city='足立区')
        got, asked, _ = self.run_with({'宮城': [town], '仙台駅': [sushi], '仙台 駅': [sendai]}, '宮城')
        self.assertEqual((got['name'], got['pref']), ('仙台駅', '宮城県'))
        self.assertEqual(asked, ['宮城', '宮城駅', '仙台駅', '仙台 駅'])
        en, _, _ = self.run_with({'Okinawa': [], 'Okinawa Station': [], '那覇空港駅': [bike], '那覇空港 駅': [naha]}, 'Okinawa', 'en')
        self.assertEqual((en['name'], en['ja']), ('Naha Airport Station', '那覇空港駅'))
        # 「市ヶ谷」のように駅を付けずに書いて「市ヶ谷駅」でも駅が無いときも、「市ヶ谷 駅」を引く
        got, asked, _ = self.run_with({'市ヶ谷': [hit('place', 'quarter', '市谷', 35.69, 139.73)],
                                       '市ヶ谷 駅': [hit('railway', 'station', '市ケ谷', 35.6932, 139.7368)]}, '市ヶ谷')
        self.assertEqual(got['name'], '市ケ谷駅')
        self.assertEqual(asked, ['市ヶ谷', '市ヶ谷駅', '市ヶ谷 駅'])
        # 英語で Station と書いたときは、すでに駅だけを探す書き方なので引き直さない
        _, asked, _ = self.run_with({}, 'Sendai Station', 'en')
        self.assertEqual(asked, ['Sendai Station'])

    def test_station_note_is_dropped(self):
        # 本物の返事の形: 「東京駅」で駅が当たらないときに残るのは「東京駅(改札外)」「東京駅(改札外);丸の内中央口」の通路
        for raw in ('東京駅(改札外)', '東京駅（改札内）', '東京駅(改札外);丸の内中央口', '東京駅;地下2階'):
            got, _, _ = self.run_with({'東京駅': [hit('highway', 'footway', raw, 35.6813, 139.7645)]}, '東京駅')
            self.assertEqual(got['name'], '東京駅', raw)
        # 駅のあとでない括弧や、駅の名前そのものは削らない
        for raw in ('Naha-kūkō (Airport) Station', '那覇空港駅', '梅田（大阪）', 'ホテル(本館)'):
            self.assertEqual(places._bare(raw), raw)
        en, _, _ = self.run_with({'那覇空港駅': [{**hit('building', 'train_station', '那覇空港駅', 26.2066, 127.6522, 'Naha-kūkō (Airport) Station',
                                                          code='JP-47', city='Naha')}]}, '那覇空港駅', 'en')
        self.assertEqual(en['name'], 'Naha-kūkō (Airport) Station')

    def test_station_building_before_others(self):
        # 本物の返事の形: 「那覇空港駅」の 1 件目は貸し自転車、2 件目が英語の名前を持つ駅舎。駅が当たらなければ駅舎にする
        bike = hit('amenity', 'bicycle_rental', '那覇空港駅', 26.2062943, 127.6521719, code='JP-47', city='Naha')
        hall = hit('building', 'train_station', '那覇空港駅', 26.2065834, 127.6522013, 'Naha-kūkō (Airport) Station', code='JP-47', city='Naha')
        en, asked, _ = self.run_with({'那覇空港駅': [bike, hall]}, '那覇空港駅', 'en')
        self.assertEqual((en['name'], en['ja'], en['lat']), ('Naha-kūkō (Airport) Station', '那覇空港駅', 26.206583))
        self.assertEqual(asked, ['那覇空港駅', '那覇空港 駅'])
        got, _, _ = self.run_with({'那覇空港駅': [bike]}, '那覇空港駅')
        self.assertEqual(got['lat'], 26.206294)

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
        self.assertEqual(asked, ['福岡県 福岡駅', '福岡県 福岡 駅', '福岡市 福岡駅', '福岡市'])
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

    def test_prefecture_only_goes_to_gateway(self):
        # 本物の返事の形: 「沖縄」で返るのは沖縄市（地域）。沖縄駅は無いので、那覇空港駅にする
        okinawa = hit('boundary', 'administrative', '沖縄', 26.334374, 127.80566, 'Okinawa', code='JP-47', city='沖縄市')
        naha = hit('railway', 'station', '那覇空港', 26.2063, 127.6522, 'Naha Airport', code='JP-47', city='那覇市')
        answers = {'沖縄': [okinawa], '沖縄駅': [], '沖縄県': [okinawa], 'Okinawa': [okinawa], 'Okinawa Station': [],
                   'Okinawa Prefecture': [okinawa], '那覇空港駅': [naha]}
        got, asked, cache = self.run_with(answers, '沖縄')
        self.assertEqual((got['name'], got['pref'], got['city'], got['lat']), ('那覇空港駅', '沖縄県', '那覇市', 26.2063))
        self.assertEqual(asked, ['沖縄', '沖縄駅', '那覇空港駅'])
        self.assertEqual(sorted(cache), sorted([places.find_key('ja', '沖縄'), places.find_key('ja', '那覇空港駅')]))
        with mock.patch.object(places, '_search', side_effect=AssertionError('呼ばない')):
            self.assertEqual(places.geocode('沖縄', 'ja', cache)['name'], '那覇空港駅')
        for q in ('沖縄県', ' 沖縄 ', 'Okinawa Prefecture'):
            got, _, _ = self.run_with(answers, q)
            self.assertEqual(got['name'], '那覇空港駅', q)
        en, asked, _ = self.run_with(answers, 'Okinawa', 'en')
        self.assertEqual((en['name'], en['ja'], en['pref']), ('Naha Airport Station', '那覇空港駅', 'Okinawa'))
        self.assertEqual(asked, ['Okinawa', 'Okinawa Station', '那覇空港駅'])
        # 北海道は道の真ん中（大雪山のあたり）ではなく札幌駅
        hokkaido = hit('boundary', 'administrative', '北海道', 43.45, 142.82, 'Hokkaido', code='JP-01', city='')
        sapporo = hit('railway', 'station', '札幌', 43.0686, 141.3508, 'Sapporo', code='JP-01', city='札幌市')
        for q, lang, name in (('北海道', 'ja', '札幌駅'), ('Hokkaido', 'en', 'Sapporo Station')):
            got, _, _ = self.run_with({q: [hokkaido], '札幌駅': [sapporo]}, q, lang)
            self.assertEqual((got['name'], got['lat']), (name, 43.0686), q)

    def test_prefecture_only_skips_other_stations(self):
        # 本物の返事の形: 「神奈川」は神奈川駅（京急の小さな駅）、「宮城」は東京都の地名が返る。どちらも玄関口の駅にする
        kanagawa = hit('railway', 'station', '神奈川', 35.4715, 139.6275, code='JP-14', city='横浜市')
        yokohama = hit('railway', 'station', '横浜', 35.4660, 139.6223, 'Yokohama', code='JP-14', city='横浜市')
        got, asked, _ = self.run_with({'神奈川': [kanagawa], '横浜駅': [yokohama]}, '神奈川')
        self.assertEqual((got['name'], got['lat']), ('横浜駅', 35.466))
        self.assertEqual(asked, ['神奈川', '横浜駅'])
        tokyo = hit('place', 'neighbourhood', '宮城', 35.7598, 139.7549, code='JP-13', city='足立区')
        sendai = hit('railway', 'station', '仙台', 38.2601, 140.8822, 'Sendai', code='JP-04', city='仙台市')
        got, asked, _ = self.run_with({'宮城': [tokyo], '仙台駅': [sendai]}, '宮城')
        self.assertEqual((got['name'], got['pref']), ('仙台駅', '宮城県'))
        self.assertEqual(asked, ['宮城', '宮城駅', '仙台駅'])
        # 本物の返事の形: 「名古屋駅」の上位に駅として分類された物が無くても、名古屋駅という名前の場所にする（「名古屋駅」と書いたときと同じ）
        aichi = hit('railway', 'station', '愛知御津', 34.8127, 137.3163, code='JP-23', city='豊川市')
        stop = hit('highway', 'bus_stop', '名古屋駅', 35.17306, 136.88161, code='JP-23', city='名古屋市')
        got, asked, _ = self.run_with({'愛知': [aichi], '名古屋駅': [stop]}, '愛知')
        self.assertEqual((got['name'], got['lat'], got['pref']), ('名古屋駅', 35.17306, '愛知県'))
        self.assertEqual(asked, ['愛知', '名古屋駅', '名古屋 駅'])

    def test_prefecture_with_own_station_is_unchanged(self):
        # 県名と同じ名前の駅が県庁所在地にあれば、問い合わせを増やさずその駅のまま
        for q, code, pref in (('京都', 'JP-26', '京都府'), ('長野', 'JP-20', '長野県')):
            st = hit('railway', 'station', q, 35.0, 136.0, q.title(), code=code, city=q + '市')
            got, asked, _ = self.run_with({q: [st]}, q)
            self.assertEqual((got['name'], got['pref']), (q + '駅', pref))
            self.assertEqual(asked, [q])
        town = hit('place', 'city', '長野', 36.65, 138.18, code='JP-20', city='長野市')
        st = hit('railway', 'station', '長野', 36.643, 138.189, code='JP-20', city='長野市')
        got, asked, _ = self.run_with({'長野': [town], '長野駅': [st]}, '長野')
        self.assertEqual(got['name'], '長野駅')
        self.assertEqual(asked, ['長野', '長野駅'])

    def test_prefecture_head_keeps_place(self):
        # 県名で始まるだけ（沖縄市・沖縄県庁・北海道大学）は、その場所のまま。玄関口は引かない
        cases = {'沖縄市': hit('boundary', 'administrative', '沖縄市', 26.334, 127.805, code='JP-47', city='沖縄市'),
                 '沖縄県庁': hit('office', 'government', '沖縄県庁', 26.2124, 127.6809, code='JP-47', city='那覇市'),
                 '沖縄そば屋': hit('amenity', 'restaurant', '沖縄そば屋', 26.21, 127.68, code='JP-47', city='那覇市'),
                 '北海道大学': hit('amenity', 'university', '北海道大学', 43.0743, 141.3409, code='JP-01', city='札幌市')}
        for q, x in cases.items():
            got, asked, _ = self.run_with({q: [x], '那覇空港駅': [], '札幌駅': []}, q)
            self.assertEqual(got['name'], q, q)
            self.assertNotIn('那覇空港駅', asked)
            self.assertNotIn('札幌駅', asked)
        self.assertEqual([places.pref_only(t) for t in ('沖縄', '沖縄県', 'okinawa', 'Okinawa  Prefecture', '東京都', '北海道',
                                                        '沖縄駅', '沖縄市', '北海道大学', '那覇')],
                         [47, 47, 47, 47, 13, 1, 0, 0, 0, 0])

    def test_prefecture_only_gateway_not_found_keeps_pick(self):
        # 玄関口の駅が見つからないときは、今までどおりの場所。問い合わせに失敗したら返すが取っておかない
        okinawa = hit('boundary', 'administrative', '沖縄', 26.334374, 127.80566, code='JP-47', city='沖縄市')
        got, _, cache = self.run_with({'沖縄': [okinawa]}, '沖縄')
        self.assertEqual((got['name'], got['city']), ('沖縄', '沖縄市'))
        self.assertEqual(cache[places.find_key('ja', '沖縄')]['city'], '沖縄市')
        # 玄関口の名前で、別の都道府県の場所しか当たらないときも使わない
        far = hit('railway', 'station', '那覇空港', 35.0, 139.0, code='JP-13', city='千代田区')
        got, _, _ = self.run_with({'沖縄': [okinawa], '那覇空港駅': [far]}, '沖縄')
        self.assertEqual(got['city'], '沖縄市')

        def fake(params):
            return {'沖縄': [okinawa], '沖縄駅': []}.get(params['q'])
        cache = {}
        with mock.patch.object(places, '_search', fake):
            got = places.geocode('沖縄', 'ja', cache)
        self.assertEqual(got['city'], '沖縄市')
        self.assertEqual(cache, {})
        with mock.patch.object(places, '_search', lambda params: [] if params['q'] != '那覇空港駅' else None):
            with self.assertRaises(places.GeoBusy):
                places.geocode('沖縄', 'ja', {})

    def test_prefecture_only_gateway_city_when_station_not_found(self):
        # 玄関口の駅が見つからないときは、駅を除いた名前（その県の中の市）にする
        tokyo = hit('place', 'neighbourhood', '宮城', 35.7598, 139.7549, code='JP-13', city='足立区')
        city = hit('boundary', 'administrative', '仙台市', 38.2682, 140.8694, 'Sendai', code='JP-04', city='仙台市')
        got, asked, cache = self.run_with({'宮城': [tokyo], '仙台': [city]}, '宮城')
        self.assertEqual((got['name'], got['pref']), ('仙台市', '宮城県'))
        self.assertEqual(asked, ['宮城', '宮城駅', '仙台駅', '仙台 駅', '仙台', '仙台駅', '仙台 駅'])
        self.assertEqual(cache[places.find_key('ja', '仙台駅')], {})

    def test_gateways_follow_prefs(self):
        self.assertEqual(len(places.GATEWAYS), len(places.PREFS))
        self.assertTrue(all(g.endswith('駅') for g in places.GATEWAYS))

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
