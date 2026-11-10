# 画面の言語（日本語・英語）の分け方の試験。cd server && python3 -m unittest discover -s tests
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import adjust, bus, odai, places, transit  # noqa: E402


class PlacesTest(unittest.TestCase):
    def test_non_finite_numbers_use_defaults(self):
        p = places.clean_place({'name': '試験の寺', 'lat': 35.01, 'lng': 135.79, 'stay': 'inf', 'weekday_drop': float('nan'),
                                'popularity': '1e999', 'crowd': [float('inf'), float('nan'), 2]}, 'hidden')
        self.assertEqual((p['stay'], p['weekdayDrop'], p['popularity']), (40, 1, 3))
        self.assertEqual(p['crowd'][:3], [1, 1, 2])
        self.assertIsNone(places.clean_place({'name': 'x', 'lat': float('nan'), 'lng': 135.79}, 'hidden'))
        self.assertEqual(places.num(10 ** 400, 5), 5)
        a = places.clean_area({'area': {'name': '試験', 'lat': 'NaN', 'lng': 135.7, 'radius_km': float('inf')}}, '試験')
        self.assertEqual((a['area']['lat'], a['area']['radius']), (0.0, 5))

    def test_japanese_prompt_is_unchanged(self):
        p = places.build_prompt('famous', '京都')
        self.assertNotIn('name_ja', p)
        self.assertNotIn('英語で書くこと', p)

    def test_english_prompt_asks_english_and_japanese_names(self):
        p = places.build_prompt('famous', 'Kyoto', lang='en')
        self.assertIn('英語で書くこと', p)
        self.assertIn('"name":"","name_ja":""', p)
        self.assertIn('"area":{"name":"","name_ja":""', p)
        self.assertIn('"start":{"name":"","name_ja":""', p)
        self.assertIn('tags と conditions の tag は、上の日本語の語のまま', p)

    def raw(self, **kw):
        p = {'name': 'Nanzen-ji Tenju-an', 'name_ja': '南禅寺 天授庵', 'lat': 35.0107, 'lng': 135.7932, 'district': 'Higashiyama',
             'why': 'A quiet sub-temple with a pond garden beside the famous Nanzen-ji Temple.', 'downside': 'Closes early.', 'basis': 'Few visitors.',
             'tags': ['庭', '静か', 'garden']}
        p.update(kw)
        return p

    def test_english_place_keeps_japanese_name_and_id(self):
        en = places.clean_place(self.raw(), 'hidden', 'en')
        ja = places.clean_place({**self.raw(), 'name': '南禅寺 天授庵'}, 'hidden')
        self.assertEqual(en['name'], 'Nanzen-ji Tenju-an')
        self.assertEqual(en['ja'], '南禅寺 天授庵')
        self.assertEqual(en['id'], ja['id'])            # 同じ場所は、どちらの言語でも同じ id
        self.assertEqual(en['tags'], ['庭', '静か'])      # タグは日本語の印のまま
        self.assertEqual(places.jname(en), '南禅寺 天授庵')
        self.assertGreater(len(en['why']), 60)          # 英語は長めまで残す

    def test_japanese_place_has_no_japanese_name_field(self):
        ja = places.clean_place(self.raw(name='南禅寺 天授庵'), 'hidden')
        self.assertNotIn('ja', ja)
        self.assertLessEqual(len(ja['why']), 60)
        self.assertEqual(places.jname(ja), '南禅寺 天授庵')

    def test_english_area_keeps_japanese_names(self):
        a = places.clean_area({'area': {'name': 'Kyoto', 'name_ja': '京都', 'lat': 35.0, 'lng': 135.76, 'radius_km': 6},
                               'start': {'name': 'Kyoto Station', 'name_ja': '京都駅', 'lat': 34.98, 'lng': 135.75},
                               'districts': ['Higashiyama', 'Northern Kyoto']}, 'Kyoto', 'en')
        self.assertEqual((a['area']['name'], a['area']['ja']), ('Kyoto', '京都'))
        self.assertEqual((a['start']['name'], a['start']['ja']), ('Kyoto Station', '京都駅'))
        self.assertEqual(a['districts'], ['Higashiyama', 'Northern Kyoto'])

    def test_english_condition_label(self):
        c = places.clean_conditions({'conditions': [{'tag': '静か', 'label': 'Quiet places away from crowds'}]}, 'en')
        self.assertEqual(c, [{'tag': '静か', 'label': 'Quiet places away from crowds'}])


class CacheKeyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app
        cls.app = app

    def test_english_cache_is_separate_and_japanese_key_is_unchanged(self):
        a = self.app
        self.assertEqual(a.key_of('area', '京都', *a.lang_tail('ja')), a.key_of('area', '京都'))
        self.assertNotEqual(a.key_of('area', 'Kyoto', *a.lang_tail('en')), a.key_of('area', 'Kyoto'))
        self.assertNotEqual(a.key_of('wish', 'Kyoto', 'soba', *a.lang_tail('en')), a.key_of('wish', 'Kyoto', 'soba'))
        self.assertEqual(a.lang_of('fr'), 'ja')

    def test_areas_are_listed_per_language(self):
        with tempfile.TemporaryDirectory() as d:
            for name, body in (('area-1.json', {'query': '京都', 'area': {'name': '京都'}, 'createdAt': 1}),
                               ('area-2.json', {'query': 'Kyoto', 'area': {'name': 'Kyoto'}, 'lang': 'en', 'createdAt': 2}),
                               ('area-3.json', {'query': '鎌倉', 'area': {'name': '鎌倉'}, 'lang': 'ja', 'createdAt': 3})):
                with open(os.path.join(d, name), 'w', encoding='utf-8') as f:
                    json.dump(body, f)
            self.assertEqual(self.app.area_names('ja', d), ['京都', '鎌倉'])
            self.assertEqual(self.app.area_names('en', d), ['Kyoto'])

    def test_english_sample_has_the_same_places(self):
        here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
        ja = json.load(open(os.path.join(here, 'sample.json'), encoding='utf-8'))
        en = json.load(open(os.path.join(here, 'sample.en.json'), encoding='utf-8'))
        self.assertEqual([p['id'] for p in en['places']], [p['id'] for p in ja['places']])
        for a, b in zip(en['places'], ja['places']):
            self.assertEqual((a['lat'], a['lng'], a['crowd'], a['open'], a['close'], a['tags'], a.get('placeId')),
                             (b['lat'], b['lng'], b['crowd'], b['open'], b['close'], b['tags'], b.get('placeId')))
            self.assertEqual(a['ja'], b['name'])
        self.assertEqual(en['area']['ja'], ja['area']['name'])


class PromptTest(unittest.TestCase):
    def test_adjust_reply_in_english(self):
        body = {'request': 'End the day in Arashiyama', 'lang': 'en', 'places': [], 'plan': []}
        self.assertIn('英語で書くこと', adjust.build_prompt(body))
        self.assertNotIn('英語で書くこと', adjust.build_prompt({**body, 'lang': 'ja'}))
        self.assertEqual(adjust.clean({'ops': []}, body)['reply'], 'Nothing could be changed.')
        self.assertEqual(adjust.clean({'ops': []}, {**body, 'lang': 'ja'})['reply'], '変更できる所が見つかりませんでした。')

    def test_odai_in_english(self):
        body = {'lang': 'en', 'place': {'name': 'Nishiki Market'}, 'examples': ['Take a close-up of a street food snack before you eat it']}
        self.assertIn('英語で書くこと', odai.build_prompt(body))
        self.assertEqual(odai.clean({'text': 'Photograph a lantern up close.'}, 'en'), 'Photograph a lantern up close')

    def test_transit_names_in_english(self):
        self.assertIn('英語のふつうの名前', transit.build_prompt('Kyoto Station', 'Arashiyama', 'en'))
        self.assertEqual(transit.build_prompt('京都駅', '嵐山'), transit.PROMPT.format(frm='京都駅', to='嵐山'))


class BusEnglishTest(unittest.TestCase):
    def test_translations_by_record_and_value(self):
        en = bus._translations([
            {'table_name': 'stops', 'field_name': 'stop_name', 'language': 'en', 'translation': 'Kyoto Station', 'record_id': '1', 'record_sub_id': '', 'field_value': ''},
            {'table_name': 'trips', 'field_name': 'trip_headsign', 'language': 'en', 'translation': 'Ginkakuji Temple via Gion', 'record_id': '', 'record_sub_id': '', 'field_value': '清水寺・祇園・銀閣寺'},
            {'table_name': 'stops', 'field_name': 'stop_name', 'language': 'ko', 'translation': '교토역', 'record_id': '1', 'record_sub_id': '', 'field_value': ''},
        ])
        self.assertEqual(en('stops', 'stop_name', '1', '京都駅前'), 'Kyoto Station')
        self.assertEqual(en('trips', 'trip_headsign', '', '清水寺・祇園・銀閣寺'), 'Ginkakuji Temple via Gion')
        self.assertEqual(en('stops', 'stop_name', '2', '五条坂'), '')
        old = bus._translations([{'trans_id': '五条坂', 'lang': 'en', 'translation': 'Gojozaka'}])
        self.assertEqual(old('stops', 'stop_name', '9', '五条坂'), 'Gojozaka')

    def test_english_names_are_used_only_in_english(self):
        trip = {'agency': '市バス', 'route': '206', 'headsign': '北大路バスターミナル', 'board': {'name': '京都駅前'}, 'alight': {'name': '五条坂'},
                'en': {'agency': 'City Bus', 'headsign': 'Kitaoji Bus Terminal', 'board': 'Kyoto Station', 'alight': 'Gojozaka'}}
        ja = bus.in_lang(json.loads(json.dumps(trip)), 'ja')
        self.assertNotIn('en', ja)
        self.assertEqual((ja['agency'], ja['board']['name']), ('市バス', '京都駅前'))
        en = bus.in_lang(json.loads(json.dumps(trip)), 'en')
        self.assertNotIn('en', en)
        self.assertEqual((en['agency'], en['route'], en['headsign'], en['board']['name'], en['alight']['name']),
                         ('City Bus', '206', 'Kitaoji Bus Terminal', 'Kyoto Station', 'Gojozaka'))

    def test_route_without_english_keeps_only_numbers_and_letters(self):
        def en(route, names=None):
            trip = {'agency': '市バス', 'route': route, 'headsign': '四条河原町', 'en': names if names is not None else {'agency': 'City Bus'}}
            return bus.in_lang(trip, 'en')['route']
        self.assertEqual(en('五条通5'), '5')
        self.assertEqual(en('西大路四条205'), '205')
        self.assertEqual(en('観光特急EX100'), 'EX100')
        self.assertEqual(en('34・35'), '34/35')
        self.assertEqual(en('快速35', {}), '35')
        self.assertEqual(en('【岩倉経由】国際会館駅前→岩倉'), '【岩倉経由】国際会館駅前→岩倉')
        self.assertEqual(en('206', {'route': 'Route 206'}), 'Route 206')
        self.assertEqual(en('五条通5', {'agency': 'City Bus', 'route': '五条通5'}), '5')
        ja = bus.in_lang({'agency': '市バス', 'route': '五条通5', 'en': {'agency': 'City Bus'}}, 'ja')
        self.assertEqual(ja['route'], '五条通5')
        self.assertNotIn('en', ja)

    def test_english_labels_drop_operator_and_via(self):
        self.assertEqual(bus._route_en('205 City Bus', 'City Bus'), '205')
        self.assertEqual(bus._headsign_en('Subway Takeda Station (Nishiguchi) via JR Katsuragawa Station'), 'Subway Takeda Station')


if __name__ == '__main__':
    unittest.main()
