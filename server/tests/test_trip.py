# 出発地と到着地の旅の試験（地名を引く・旅の範囲・頼みの文・作り置きの鍵・受け口・候補集めの通し）。
# cd server && python3 -m unittest discover -s tests
import json, os, sys, tempfile, threading, time, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
from test_guard import Served, post  # noqa: E402
import app  # noqa: E402
import places  # noqa: E402
import fake_trip_llm  # noqa: E402

ICHIGAYA = {'text': '市ヶ谷', 'name': '市ヶ谷駅', 'lat': 35.693244, 'lng': 139.736809}
IIDABASHI = {'text': '飯田橋', 'name': '飯田橋駅', 'lat': 35.701033, 'lng': 139.747482}
KYOTO = {'text': '京都駅', 'name': '京都駅', 'lat': 34.98535, 'lng': 135.758766}


class TripShapeTest(unittest.TestCase):
    def test_point_checks(self):
        self.assertEqual(places.trip_point({'text': ' 市ヶ谷 ', 'name': '市ヶ谷駅', 'lat': 35.69, 'lng': 139.73})['text'], '市ヶ谷')
        for bad in (None, {'text': '', 'lat': 35, 'lng': 139}, {'text': 'a', 'lat': 'x', 'lng': 139}, {'text': 'a', 'lat': 48.8, 'lng': 2.3},
                    {'text': 'a', 'lat': True, 'lng': 139}, {'text': 'a', 'lat': float('nan'), 'lng': 139}):
            self.assertIsNone(places.trip_point(bad), bad)

    def test_names(self):
        self.assertEqual(places.trip_of(ICHIGAYA)['name'], '市ヶ谷')
        self.assertEqual(places.trip_of(ICHIGAYA, IIDABASHI)['name'], '市ヶ谷〜飯田橋')
        self.assertEqual(places.trip_of(ICHIGAYA, IIDABASHI, lang='en')['name'], '市ヶ谷 – 飯田橋')
        self.assertEqual(places.trip_of(KYOTO, area='京都')['name'], '京都')

    def test_near_end_is_round_trip(self):
        near = {**ICHIGAYA, 'text': '市ヶ谷駅', 'lat': ICHIGAYA['lat'] + 0.001}
        self.assertIsNone(places.trip_of(ICHIGAYA, near)['end'])

    def test_far(self):
        self.assertFalse(places.trip_of(ICHIGAYA, IIDABASHI)['far'])
        self.assertTrue(places.trip_of(ICHIGAYA, KYOTO)['far'])

    def test_keys_differ_by_end(self):
        one, back = places.trip_of(ICHIGAYA, IIDABASHI), places.trip_of(ICHIGAYA)
        self.assertNotEqual(places.trip_key(one), places.trip_key(back))
        self.assertNotEqual(places.trip_key(one), places.trip_key(places.trip_of(IIDABASHI, ICHIGAYA)))
        self.assertEqual(places.trip_key(back), places.trip_key(places.trip_of({**ICHIGAYA, 'lat': ICHIGAYA['lat'] + 0.0001})))

    def test_prompt_area(self):
        one = places.trip_prompt_area(places.trip_of(ICHIGAYA, IIDABASHI))
        self.assertIn('市ヶ谷駅から出発して、飯田橋駅まで', one)
        self.assertIn('到着地: 飯田橋駅（北緯 35.7010・東経 139.7475）', one)
        back = places.trip_prompt_area(places.trip_of(ICHIGAYA))
        self.assertIn('市ヶ谷駅から出発して、市ヶ谷駅に戻る', back)
        self.assertNotIn('到着地', back)
        # 頼みの本文の「エリア:」の所に入る
        self.assertIn('エリア: 市ヶ谷〜飯田橋\n旅: ', places.build_prompt('famous', one))
        en = places.trip_prompt_area(places.trip_of({**ICHIGAYA, 'name': 'Ichigaya Station', 'ja': '市ヶ谷駅'}, lang='en'))
        self.assertIn('市ヶ谷駅から出発して', en)

    def test_wish_reach(self):
        area = {'name': '博多', 'lat': 33.5897, 'lng': 130.4207, 'radius': 2.0}
        dazaifu, beppu = {'lat': 33.5215, 'lng': 130.5349}, {'lat': 33.3157, 'lng': 131.4722}
        self.assertFalse(places.in_area(dazaifu, area))
        self.assertTrue(places.in_reach(dazaifu, area))
        self.assertFalse(places.in_reach(beppu, area))
        # 片道の旅は到着地からも数える
        self.assertTrue(places.in_reach({'lat': 33.40, 'lng': 130.40}, area, ({'lat': 33.48, 'lng': 130.40},)))
        wide = places.reach_area(area, [dazaifu])
        self.assertTrue(places.in_area(dazaifu, wide))
        self.assertEqual((wide['lat'], wide['radius'] > 2.0, area['radius']), (area['lat'], True, 2.0))
        self.assertIs(places.reach_area(area, [{'lat': 33.59, 'lng': 130.42}]), area)

    def test_wish_named(self):
        self.assertIn('"named":false', places.build_prompt('wish', '博多', '太宰府に行きたい'))
        self.assertIn('"named":false', places.build_prompt('wish', 'Hakata', 'I want to visit Dazaifu', 'en'))
        self.assertNotIn('named', places.build_prompt('famous', '博多'))
        raw = {'name': '太宰府天満宮', 'lat': 33.52, 'lng': 130.53, 'named': True}
        self.assertIs(places.clean_place(raw, 'wish')['named'], True)
        self.assertNotIn('named', places.clean_place(raw, 'famous'))
        self.assertNotIn('named', places.clean_place({**raw, 'named': 'true'}, 'wish'))
        many = places.keep_named([places.clean_place({**raw, 'name': f'場所{i}'}, 'wish') for i in range(5)])
        self.assertEqual([bool(p.get('named')) for p in many], [True, True, True, False, False])

    def test_area_hint(self):
        self.assertEqual(places.area_hint({'name': '市ヶ谷〜飯田橋'}), '市ヶ谷 飯田橋')
        self.assertEqual(places.area_hint({'name': 'Ichigaya – Iidabashi', 'ja': '市ヶ谷駅〜飯田橋駅'}), '市ヶ谷駅 飯田橋駅')
        self.assertEqual(places.area_hint({'name': '京都'}), '京都')


def gemini_area(lat, lng, radius=2.0):
    return {'area': {'name': 'Gemini の名前', 'lat': lat, 'lng': lng, 'radius': radius},
            'start': {'name': 'Gemini の駅', 'lat': 35.0, 'lng': 135.0}, 'districts': []}


class PlaceTripTest(unittest.TestCase):
    def test_one_way(self):
        trip = places.trip_of(ICHIGAYA, IIDABASHI)
        ad = gemini_area(35.697, 139.742)
        places.place_trip(ad, [], trip)
        mid = ((ICHIGAYA['lat'] + IIDABASHI['lat']) / 2, (ICHIGAYA['lng'] + IIDABASHI['lng']) / 2)
        self.assertAlmostEqual(ad['area']['lat'], mid[0], places=5)
        self.assertEqual(ad['area']['name'], '市ヶ谷〜飯田橋')
        self.assertEqual((ad['start']['name'], ad['start']['lat']), ('市ヶ谷駅', ICHIGAYA['lat']))
        self.assertEqual((ad['end']['name'], ad['end']['lng']), ('飯田橋駅', IIDABASHI['lng']))
        for p in (ICHIGAYA, IIDABASHI):
            self.assertTrue(places.in_area(p, ad['area']))

    def test_round_trip_keeps_radius(self):
        ad = gemini_area(35.003, 135.759, 6)
        places.place_trip(ad, [], places.trip_of(KYOTO, area='京都'))
        self.assertEqual((ad['area']['lat'], ad['area']['radius'], ad['area']['name']), (KYOTO['lat'], 6, '京都'))
        self.assertNotIn('end', ad)
        self.assertEqual(ad['start']['name'], '京都駅')

    def test_long_one_way_covers_both_ends(self):
        kamakura = {'text': '鎌倉', 'name': '鎌倉駅', 'lat': 35.3192, 'lng': 139.5503}
        enoshima = {'text': '江ノ島', 'name': '片瀬江ノ島駅', 'lat': 35.3094, 'lng': 139.4873}
        ad = gemini_area(35.31, 139.52)
        places.place_trip(ad, [], places.trip_of(kamakura, enoshima))
        for p in (kamakura, enoshima, {'lat': 35.3192 + 0.012, 'lng': 139.5503}):
            self.assertTrue(places.in_area(p, ad['area']), p)

    def test_wrong_longitude_is_shifted_back(self):
        # Gemini が中心と候補の経度を 139 ではなく 135 と書いた形
        trip = places.trip_of(ICHIGAYA, IIDABASHI)
        ad = gemini_area(35.697, 135.742)
        ps = [{'name': 'p', 'lat': 35.695, 'lng': 135.740}, {'name': 'q', 'lat': 35.699, 'lng': 135.745}]
        self.assertTrue(places.place_trip(ad, ps, trip))
        self.assertTrue(all(places.in_area(p, ad['area']) for p in ps))

    def test_english_area_has_japanese_name(self):
        s = {**ICHIGAYA, 'text': 'Ichigaya', 'name': 'Ichigaya Station', 'ja': '市ヶ谷駅'}
        e = {**IIDABASHI, 'text': 'Iidabashi', 'name': 'Iidabashi Station', 'ja': '飯田橋駅'}
        ad = gemini_area(35.697, 139.742)
        places.place_trip(ad, [], places.trip_of(s, e, lang='en'), 'en')
        self.assertEqual((ad['area']['name'], ad['area']['ja']), ('Ichigaya – Iidabashi', '市ヶ谷駅〜飯田橋駅'))
        self.assertEqual((ad['start']['name'], ad['start']['ja']), ('Ichigaya Station', '市ヶ谷駅'))


class CacheKeyTripTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(app, 'CACHE', self.dir.name)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.dir.cleanup()

    def save(self, key, d):
        app.save_json(app.path_of('area', key), d)

    def test_one_way_and_round_trip_differ(self):
        one = app.job_plan('市ヶ谷', '', 'ja', places.trip_of(ICHIGAYA, IIDABASHI))
        back = app.job_plan('市ヶ谷', '', 'ja', places.trip_of(ICHIGAYA))
        old = app.job_plan('市ヶ谷', '', 'ja')
        self.assertEqual(len({one[0], back[0], old[0]}), 3)
        self.assertNotEqual(one[1], back[1])

    def test_old_area_cache_is_used_for_round_trip_near_start(self):
        self.save(app.key_of('area', '京都'), {'area': {'name': '京都', 'lat': 35.0, 'lng': 135.76, 'radius': 6},
                                              'start': {'name': '京都駅', 'lat': 34.9858, 'lng': 135.7588}, 'places': []})
        akey, _, data, _, tasks = app.job_plan('京都', '', 'ja', places.trip_of(KYOTO, area='京都'))
        self.assertEqual((akey, tasks), (app.key_of('area', '京都'), []))
        self.assertEqual(data['area']['name'], '京都')
        # 出発地が遠い・片道の旅では使わない
        far = {**KYOTO, 'text': '嵐山', 'lat': 35.0094, 'lng': 135.6668}
        self.assertTrue(app.job_plan('京都', '', 'ja', places.trip_of(far, area='京都'))[4])
        arashi = {**KYOTO, 'text': '嵐山', 'name': '嵐山駅', 'lat': 35.0094, 'lng': 135.6668}
        self.assertTrue(app.job_plan('京都', '', 'ja', places.trip_of(KYOTO, arashi, area='京都'))[4])

    def test_presets_have_start_and_skip_one_way(self):
        self.save('a', {'area': {'name': '京都'}, 'start': {'name': '京都駅', 'lat': 34.98, 'lng': 135.75}, 'query': '京都', 'createdAt': 1})
        self.save('b', {'area': {'name': '京都'}, 'start': {'name': '京都駅', 'lat': 34.99, 'lng': 135.76}, 'query': '京都', 'createdAt': 2})
        self.save('c', {'area': {'name': '市ヶ谷〜飯田橋'}, 'start': {'name': '市ヶ谷駅', 'lat': 35.69, 'lng': 139.73},
                        'end': {'name': '飯田橋駅', 'lat': 35.70, 'lng': 139.74}, 'query': '市ヶ谷', 'createdAt': 3})
        self.save('d', {'area': {'name': '市ヶ谷'}, 'start': {'name': '市ヶ谷駅', 'lat': 35.69, 'lng': 139.73},
                        'end': {'name': '飯田橋駅', 'lat': 35.70, 'lng': 139.74}, 'query': '市ヶ谷', 'createdAt': 4})
        got = app.area_presets('ja')
        self.assertEqual(list(got), ['京都'])
        self.assertEqual(got['京都']['lat'], 34.99)


class TripServedTest(Served):
    def test_far_is_refused_before_making(self):
        code, d = post(self.port, '/api/jobs', {'start': ICHIGAYA, 'end': KYOTO, 'wish': ''}, who='203.0.113.40')
        self.assertEqual((code, d['error']), (400, 'far'))
        self.assertGreater(d['km'], 300)

    def test_bad_points(self):
        for body in ({'start': {'text': 'x'}}, {'start': ICHIGAYA, 'end': {'text': '飯田橋', 'lat': 0, 'lng': 0}}):
            code, d = post(self.port, '/api/jobs', body, who='203.0.113.41')
            self.assertEqual((code, d['error']), (400, 'bad'))


def fake_matrix(pts):
    n = len(pts)
    walk = [[round(places.dist_m((a['lat'], a['lng']), (b['lat'], b['lng'])) / 75) for b in pts] for a in pts]
    return {'walk': walk, 'drive': [[None] * n for _ in pts]}


class RunTripTest(unittest.TestCase):
    """偽の Gemini（fake_trip_llm）で、候補集めを通しで回す（外への問い合わせは全部差し替える）"""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(app, 'CACHE', self.dir.name), mock.patch.object(app, 'llm', fake_trip_llm),
                        mock.patch.object(app, 'GEO', {}), mock.patch.object(app, 'GEO_PATH', os.path.join(self.dir.name, 'geo.json')),
                        mock.patch.object(app, 'PHOTO_PATH', os.path.join(self.dir.name, 'photo.json')),
                        mock.patch.object(app, 'add_photos', lambda plist, area: None),
                        mock.patch.object(app.enrich, 'matrix', fake_matrix), mock.patch.object(app.elev, 'heights', lambda pts: None),
                        mock.patch.object(places, 'verify_one', lambda p, area, cache: p.update(verified=True)),
                        mock.patch.object(places, 'verify_start', side_effect=AssertionError('旅の出発地は確かめ直さない')),
                        mock.patch.object(places, 'area_anchor', side_effect=AssertionError('旅ではエリアの名前を引かない'))]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.dir.cleanup()

    def run_trip(self, trip, wish=''):
        job = {'id': 'x', 'key': 'x', 'state': 'running', 'steps': [], 'done': 0, 'total': 0, 't0': time.time(), 'times': {}}
        t = threading.Thread(target=app.run_job, args=(job, trip['area'], wish, 'ja', trip))
        t.start()
        t.join(60)
        self.assertEqual(job['state'], 'done', job.get('error'))
        return job['result']

    def test_one_way(self):
        before = len(fake_trip_llm.CALLS)
        r = self.run_trip(places.trip_of(ICHIGAYA, IIDABASHI))
        self.assertEqual(len(fake_trip_llm.CALLS) - before, len(places.AREA_TASKS))
        self.assertEqual(r['area']['name'], '市ヶ谷〜飯田橋')
        self.assertEqual((r['start']['name'], r['start']['lat']), ('市ヶ谷駅', ICHIGAYA['lat']))
        self.assertEqual((r['end']['name'], r['end']['lat']), ('飯田橋駅', IIDABASHI['lat']))
        self.assertEqual(r['matrix']['ids'][:2], ['start', 'end'])
        self.assertEqual(len(r['matrix']['ids']), len(r['places']) + 2)
        self.assertEqual(r['query']['end']['text'], '飯田橋')
        self.assertGreaterEqual(len(r['places']), 8)
        # 同じ旅は作り置きから（Gemini を呼ばない）
        n = len(fake_trip_llm.CALLS)
        again = self.run_trip(places.trip_of(ICHIGAYA, IIDABASHI))
        self.assertEqual(len(fake_trip_llm.CALLS), n)
        self.assertEqual(again['end']['name'], '飯田橋駅')

    def test_round_trip(self):
        r = self.run_trip(places.trip_of(ICHIGAYA))
        self.assertNotIn('end', r)
        self.assertEqual(r['matrix']['ids'][0], 'start')
        self.assertNotIn('end', r['matrix']['ids'])
        self.assertEqual((r['area']['lat'], r['area']['lng']), (ICHIGAYA['lat'], ICHIGAYA['lng']))

    def test_wrong_longitude_from_gemini(self):
        with mock.patch.dict(os.environ, {'ZT_FAKE_SHIFT': '1'}):
            r = self.run_trip(places.trip_of(ICHIGAYA, IIDABASHI))
        self.assertGreaterEqual(len(r['places']), 8)
        self.assertTrue(all(139.6 < p['lng'] < 139.9 for p in r['places']))

    def test_far_wish_is_kept_and_area_reaches_it(self):
        hakata = places.trip_point({'text': '博多', 'name': '博多駅', 'lat': 33.5897, 'lng': 130.4207})
        wish = {'conditions': [], 'places': [
            {'name': '太宰府天満宮', 'kind': 'sight', 'role': 'famous', 'lat': 33.5215, 'lng': 130.5349, 'stay': 60,
             'open': '06:30', 'close': '19:00', 'why': '学問の神様を祀る。', 'tags': [], 'named': True},
            {'name': '別府の地獄めぐり', 'kind': 'sight', 'role': 'famous', 'lat': 33.3157, 'lng': 131.4722, 'stay': 60,
             'open': '08:00', 'close': '17:00', 'why': '温泉が湧く。', 'tags': []}]}
        real = fake_trip_llm.ask

        def ask(prompt, model=''):
            return json.dumps(wish, ensure_ascii=False) if prompt.startswith('次のエリアを 1 日で観光する人の希望') else real(prompt, model)
        with mock.patch.object(app, 'llm', mock.Mock(wraps=fake_trip_llm, ask=ask)):
            r = self.run_trip(places.trip_of(hakata), '太宰府に行きたい')
        names = [p['name'] for p in r['places']]
        self.assertIn('太宰府天満宮', names)
        self.assertNotIn('別府の地獄めぐり', names)
        dazaifu = next(p for p in r['places'] if p['name'] == '太宰府天満宮')
        self.assertTrue(places.in_area(dazaifu, r['area']))
        self.assertIs(dazaifu.get('named'), True)
        self.assertLessEqual(r['area']['radius'], 40.0)
        self.assertIn(dazaifu['id'], r['matrix']['ids'])
        # エリアの作り置きは広げる前の範囲のまま（ほかの希望の旅は広げない）
        saved = [app.load(os.path.join(self.dir.name, f)) for f in os.listdir(self.dir.name) if f.startswith('area-')]
        self.assertTrue(saved and all(not places.in_area(dazaifu, d['area']) for d in saved))



class SampleTripTest(unittest.TestCase):
    """京都駅から出て京都駅に戻る旅は、例のプラン（sample.json）の候補と移動の表を使い、Gemini も OSRM も呼ばない"""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(app, 'CACHE', self.dir.name), mock.patch.object(app, 'llm', fake_trip_llm),
                        mock.patch.object(app, 'GEO', {}), mock.patch.object(app, 'GEO_PATH', os.path.join(self.dir.name, 'geo.json')),
                        mock.patch.object(app, 'PHOTO_PATH', os.path.join(self.dir.name, 'photo.json')),
                        mock.patch.object(app, 'add_photos', lambda plist, area: None),
                        mock.patch.object(app.enrich, 'matrix', side_effect=AssertionError('移動の表は例のプランから')),
                        mock.patch.object(app.elev, 'heights', lambda pts: None),
                        mock.patch.object(places, 'verify_one', side_effect=AssertionError('例のプランの位置は確かめ済み')),
                        mock.patch.object(app.gplaces, 'enabled', lambda: True),
                        mock.patch.object(app.gplaces, 'search', side_effect=AssertionError('例のプランは照合しない')),
                        mock.patch.object(app.gplaces, 'location', side_effect=AssertionError('例のプランは照合しない'))]
        for p in self.patches:
            p.start()
        self.sample = json.load(open(os.path.join(app.HERE, 'sample.json'), encoding='utf-8'))
        self.en = json.load(open(os.path.join(app.HERE, 'sample.en.json'), encoding='utf-8'))

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.dir.cleanup()

    def trip(self, text='京都駅', dlat=0.0, end=None, area='', lang='ja'):
        st = (self.en if lang == 'en' else self.sample)['start']
        start = places.trip_point({'text': text, 'name': text, 'lat': st['lat'] + dlat, 'lng': st['lng']})
        return places.trip_of(start, end, area, lang)

    def test_typed_station_uses_sample_without_gemini(self):
        before = len(fake_trip_llm.CALLS)
        trip = self.trip(dlat=0.004)
        wish = ' ' + self.sample['query']['wish'].rstrip('。') + ' '
        job = {'id': 'x', 'key': 'x', 'state': 'running', 'steps': [], 'done': 0, 'total': 0, 't0': time.time(), 'times': {}}
        t = threading.Thread(target=app.run_job, args=(job, trip['area'], app.norm(wish), 'ja', trip))
        t.start()
        t.join(60)
        self.assertEqual(job['state'], 'done', job.get('error'))
        r = job['result']
        self.assertEqual(len(fake_trip_llm.CALLS), before)
        self.assertEqual([p['id'] for p in r['places']], [p['id'] for p in self.sample['places']])
        self.assertEqual(r['conditions'], self.sample['conditions'])
        self.assertEqual(r['matrix'], self.sample['matrix'])
        self.assertEqual(r['area']['name'], '京都')
        self.assertEqual(r['query']['start']['text'], '京都駅')

    def test_wish_decides_conditions(self):
        plan = app.job_plan('京都', '', 'ja', self.trip(area='京都'))
        self.assertEqual((plan[3], plan[4]), ({'conditions': [], 'places': []}, []))
        plan = app.job_plan('京都駅', '夜は居酒屋', 'ja', self.trip())
        self.assertEqual((plan[3], plan[4]), (None, ['wish']))
        self.assertEqual(len(plan[2]['places']), len(self.sample['places']))

    def test_english_uses_sample_en(self):
        plan = app.job_plan('Kyoto Station', self.en['query']['wish'].upper(), 'en', self.trip('Kyoto Station', lang='en'))
        self.assertEqual(plan[4], [])
        self.assertEqual(plan[2]['start']['name'], 'Kyoto Station')
        self.assertEqual(plan[3]['conditions'], self.en['conditions'])

    def test_far_start_or_one_way_does_not_use_sample(self):
        self.assertEqual(len(app.job_plan('京都', '', 'ja', self.trip(dlat=0.02))[4]), len(places.AREA_TASKS))
        end = places.trip_point({'text': '嵐山', 'name': '嵐山', 'lat': 35.0094, 'lng': 135.6668})
        self.assertEqual(len(app.job_plan('京都', '', 'ja', self.trip(end=end))[4]), len(places.AREA_TASKS))

    def test_areas_list_kyoto_with_station(self):
        got = app.with_sample({'京都': {'name': '四条', 'lat': 35.0, 'lng': 135.76}, '鎌倉': None}, 'ja')
        self.assertEqual(list(got), ['鎌倉', '京都'])
        self.assertEqual(got['京都']['name'], '京都駅')
        self.assertEqual(app.with_sample({}, 'en')['Kyoto']['name'], 'Kyoto Station')


if __name__ == '__main__':
    unittest.main()
