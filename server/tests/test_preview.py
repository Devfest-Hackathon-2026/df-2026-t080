# 候補を集めている間の待ち画面に出す人気スポット（preview.py）の試験。Gemini と Places を新しく呼ばないことも確かめる。
# cd server && python3 -m unittest discover -s tests
import json, os, sys, tempfile, threading, time, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
import app  # noqa: E402
import places  # noqa: E402
import preview  # noqa: E402
import fake_trip_llm  # noqa: E402
from test_trip import ICHIGAYA, KYOTO, fake_matrix  # noqa: E402

PHOTO = {'url': 'https://upload.wikimedia.org/a/250px-x.jpg', 'page': 'p', 'title': 't', 'author': 'A', 'license': 'CC BY-SA 4.0',
         'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0', 'source': 'https://commons.wikimedia.org/wiki/File:x.jpg'}


def spot(name, source='famous', kind='sight', lat=35.0, lng=135.7, **kw):
    return {'id': name, 'name': name, 'kind': kind, 'source': source, 'lat': lat, 'lng': lng, 'tags': [], 'why': f'{name}の特徴です。', **kw}


class PickTest(unittest.TestCase):
    def test_groups_by_kind_with_photos_first(self):
        got = preview.pick([spot('飲食店', kind='food', source='food'), spot('喫茶', kind='cafe', source='food'), spot('隠れた所', source='hidden'),
                            spot('A'), spot('B', photo=PHOTO), spot('希望の所', source='wish'), spot('見つからない', unfound=True),
                            spot('店', notSight=True), spot('通り', kind='street')])
        self.assertEqual({g: [p['name'] for p in v] for g, v in got.items()},
                         {'famous': ['B', 'A', '通り'], 'food': ['飲食店'], 'cafe': ['喫茶']})
        self.assertEqual(got['famous'][0]['photo'], PHOTO)
        self.assertNotIn('photo', got['famous'][1])
        self.assertEqual(set(got['famous'][1]), {'id', 'name', 'kind', 'tags', 'why', 'lat', 'lng', 'group'})
        self.assertEqual(got['food'][0]['why'], '飲食店の特徴です。', '店の一言は候補と同じ why のまま')

    def test_limits(self):
        many = [spot(f'名所{i}') for i in range(9)] + [spot(f'店{i}', kind='food', source='food') for i in range(9)] + \
            [spot(f'喫茶{i}', kind='cafe', source='food') for i in range(9)]
        got = preview.pick(many)
        self.assertEqual({g: len(v) for g, v in got.items()}, {'famous': 3, 'food': 1, 'cafe': 1})
        got = preview.pick(many + [spot(f'隠れ{i}', source='hidden') for i in range(9)])
        self.assertEqual({g: len(v) for g, v in got.items()}, {'famous': 3, 'food': 1, 'cafe': 1})
        self.assertEqual(sum(len(v) for v in got.values()), 5)

    def test_photo_without_credit_is_not_used(self):
        got = preview.pick([spot('A', photo={'url': 'https://x/250px-a.jpg', 'license': ''})])
        self.assertNotIn('photo', got['famous'][0])

    def test_photo_from_cache_by_name_and_nearby_position(self):
        cache = {'清水寺@34.99,135.79': PHOTO, '清水寺@35.50,139.00': {**PHOTO, 'url': 'far'}, '金閣寺@35.04,135.73': None}
        got = preview.pick([spot('清水寺', lat=34.9949, lng=135.7850), spot('金閣寺', lat=35.0394, lng=135.7292)], cache)['famous']
        self.assertEqual(got[0]['photo']['url'], PHOTO['url'])
        self.assertNotIn('photo', got[1])
        # 位置が 2 km ほど以上離れた同じ名前の写真は使わない
        self.assertIsNone(preview.photo_of(spot('清水寺', lat=35.2, lng=135.7), {'清水寺@35.50,139.00': PHOTO}))

    def test_english_spot_uses_japanese_name_for_photo(self):
        got = preview.pick([spot('Kiyomizu-dera', ja='清水寺', lat=34.9949, lng=135.7850)], {'清水寺@34.99,135.79': PHOTO})
        self.assertEqual(got['famous'][0]['photo'], PHOTO)

    def test_area_lists_sights_then_food(self):
        d = {'area': {'name': '京都'}, 'places': [spot('喫茶', kind='cafe', source='food'), spot('店', kind='food', source='food'),
                                                 spot('隠れ', source='hidden'), spot('寺')]}
        got = preview.of_area(d)
        self.assertEqual(got['area'], '京都')
        self.assertEqual([p['group'] for p in got['places']], ['famous', 'food', 'cafe'])


GIFU = {'area': {'name': '岐阜', 'lat': 35.42, 'lng': 136.76, 'radius_km': 5},
        'places': [{'name': '岐阜城', 'kind': 'sight', 'lat': 35.434, 'lng': 136.782, 'why': '金華山の山頂に建つ城です。'}, {'name': 'x'}]}
FOOD = {'places': [{'name': '鮎料理の店', 'kind': 'food', 'lat': 35.43, 'lng': 136.77, 'why': '鮎の塩焼きが看板です。'}]}
CAFE = {'places': [{'name': '川沿いの喫茶', 'kind': 'cafe', 'lat': 35.43, 'lng': 136.77, 'why': '長良川を眺められます。'}]}


class AnswerTest(unittest.TestCase):
    def test_famous_first_then_food_is_added_after(self):
        got = preview.of_answer(None, 'famous', GIFU, '岐阜駅', 'ja')
        self.assertEqual(got['area'], '岐阜')
        self.assertEqual([(p['name'], p['why']) for p in got['places']], [('岐阜城', '金華山の山頂に建つ城です。')])
        more = preview.of_answer(got, 'food', FOOD, '岐阜駅', 'ja')
        self.assertEqual([p['name'] for p in more['places']], ['岐阜城', '鮎料理の店'])
        self.assertEqual(more['places'][1]['why'], '鮎の塩焼きが看板です。')
        self.assertEqual([p['name'] for p in got['places']], ['岐阜城'], '前の中身は書き換えない')

    def test_food_first_uses_the_asked_name_then_famous_is_added(self):
        got = preview.of_answer(None, 'food', FOOD, '岐阜駅', 'ja')
        self.assertEqual(got['area'], '岐阜駅')
        got = preview.of_answer(got, 'cafe', CAFE, '岐阜駅', 'ja')
        got = preview.of_answer(got, 'famous', GIFU, '岐阜駅', 'ja')
        self.assertEqual([p['group'] for p in got['places']], ['food', 'cafe', 'famous'], '届いた順に後ろへ足す')
        self.assertEqual(got['area'], '岐阜駅')

    def test_kinds_already_shown_are_not_replaced(self):
        got = preview.of_area({'area': {'name': '岐阜'}, 'places': [spot('寺'), spot('店', kind='food', source='food')]})
        again = preview.of_answer(got, 'famous', GIFU, '岐阜駅', 'ja')
        self.assertEqual([p['name'] for p in again['places']], ['寺', '店'])
        again = preview.of_answer(got, 'cafe', CAFE, '岐阜駅', 'ja')
        self.assertEqual([p['name'] for p in again['places']], ['寺', '店', '川沿いの喫茶'])

    def test_unreadable_or_other_answers_keep_the_current(self):
        got = preview.of_answer(None, 'famous', GIFU, '岐阜駅', 'ja')
        self.assertIs(preview.of_answer(got, 'food', {'places': 'x'}, '岐阜駅', 'ja'), got)
        self.assertIs(preview.of_answer(got, 'food', None, '岐阜駅', 'ja'), got)
        self.assertIs(preview.of_answer(got, 'themes', {'themes': []}, '岐阜駅', 'ja'), got)
        self.assertIsNone(preview.of_answer(None, 'famous', {'places': 'x'}, '岐阜', 'ja'))


class NearTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.dir.cleanup()

    def put(self, name, lat, lng, radius, lang=None):
        d = {'area': {'name': name, 'lat': lat, 'lng': lng, 'radius': radius}, 'places': [spot(f'{name}の名所')], **({'lang': lang} if lang else {})}
        with open(os.path.join(self.dir.name, f'area-{name}.json'), 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False)

    def test_nearest_area_that_covers_the_point(self):
        self.put('京都', 34.9858, 135.7588, 12)
        self.put('東山', 34.996, 135.781, 2)
        self.put('Kyoto', 34.9858, 135.7588, 12, 'en')
        a = preview.Areas(self.dir.name)
        self.assertEqual(a.near(34.995, 135.785, 'ja')['area']['name'], '東山')
        self.assertEqual(a.near(35.03, 135.73, 'ja')['area']['name'], '京都')
        self.assertEqual(a.near(35.03, 135.73, 'en')['area']['name'], 'Kyoto')
        self.assertIsNone(a.near(35.69, 139.73, 'ja'))
        sample = preview.index_of({'area': {'name': '例', 'lat': 35.69, 'lng': 139.73, 'radius': 3}, 'places': []}, 'ja')
        self.assertEqual(a.near(35.69, 139.73, 'ja', [sample])['area']['name'], '例')

    def test_rereads_changed_files(self):
        a = preview.Areas(self.dir.name)
        self.assertIsNone(a.near(34.99, 135.76, 'ja'))
        self.put('京都', 34.9858, 135.7588, 12)
        self.assertEqual(a.near(34.99, 135.76, 'ja')['area']['name'], '京都')


class RunJobPreviewTest(unittest.TestCase):
    """候補集めの途中で、待ち画面の人気スポットが仕事に入ること。Gemini を呼ぶ回数は変わらないこと"""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(app, 'CACHE', self.dir.name), mock.patch.object(app, 'llm', fake_trip_llm),
                        mock.patch.object(app, 'GEO', {}), mock.patch.object(app, 'GEO_PATH', os.path.join(self.dir.name, 'geo.json')),
                        mock.patch.object(app, 'PHOTO', {}), mock.patch.object(app, 'PHOTO_PATH', os.path.join(self.dir.name, 'photo.json')),
                        mock.patch.object(app, 'add_photos', lambda plist, area: None),
                        mock.patch.object(app.enrich, 'matrix', fake_matrix), mock.patch.object(app.elev, 'heights', lambda pts: None),
                        mock.patch.object(places, 'verify_one', lambda p, area, cache: p.update(verified=True)),
                        mock.patch.object(app.gplaces, 'enabled', lambda: False)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.dir.cleanup()

    def run_trip(self, trip):
        job = {'id': 'x', 'key': 'x', 'state': 'running', 'steps': [], 'done': 0, 'total': 0, 't0': time.time(), 'times': {}}
        seen = []
        real = app.publish

        def publish(j, result, state):
            seen.append(json.loads(json.dumps(j.get('preview'))))
            real(j, result, state)
        with mock.patch.object(app, 'publish', publish):
            t = threading.Thread(target=app.run_job, args=(job, trip['area'], '', 'ja', trip))
            t.start()
            t.join(60)
        self.assertEqual(job['state'], 'done', job.get('error'))
        return job, seen

    def test_new_area_uses_the_first_famous_answer(self):
        before = len(fake_trip_llm.CALLS)
        job, seen = self.run_trip(places.trip_of(ICHIGAYA))
        self.assertEqual(len(fake_trip_llm.CALLS) - before, len(places.AREA_TASKS))
        self.assertTrue(seen[0] and seen[0]['places'], '最初の候補を出す前に、見どころとお店が入っている')
        groups = {p['group'] for p in seen[0]['places']}
        self.assertTrue({'famous', 'food'} <= groups, groups)
        self.assertNotIn('hidden', groups, '隠れた名所は最初の候補より後にしか届かない')
        names = {p['name'] for p in job['result']['places']}
        self.assertTrue({p['name'] for p in seen[0]['places']} <= names)

    def test_start_inside_a_kept_area_shows_it_from_the_beginning(self):
        d = {'area': {'name': '市ヶ谷のまわり', 'lat': 35.69, 'lng': 139.74, 'radius': 3}, 'lang': 'ja',
             'places': [spot('靖國神社', lat=35.694, lng=139.743, photo=PHOTO), spot('飲食店', kind='food')]}
        with open(os.path.join(self.dir.name, 'area-near.json'), 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False)
        first = []
        real = app.first_preview

        def spy(*a):
            first.append(real(*a))
            return first[-1]
        with mock.patch.object(app, 'first_preview', spy):
            job, _ = self.run_trip(places.trip_of(ICHIGAYA))
        self.assertEqual(first[0]['area'], '市ヶ谷のまわり')
        self.assertEqual([p['name'] for p in first[0]['places']], ['靖國神社', '飲食店'])
        self.assertEqual(job['preview']['area'], '市ヶ谷のまわり')
        self.assertEqual([p['name'] for p in job['preview']['places'][:2]], ['靖國神社', '飲食店'], '先に出した場所は入れ替えない')
        self.assertEqual({p['group'] for p in job['preview']['places'][2:]}, {'cafe'}, 'まだ無い種類（カフェ）だけを足す')

    def test_kept_area_needs_no_preview(self):
        trip = places.trip_of(ICHIGAYA)
        self.run_trip(trip)
        n = len(fake_trip_llm.CALLS)
        job, _ = self.run_trip(trip)
        self.assertEqual(len(fake_trip_llm.CALLS), n)
        self.assertIsNone(job.get('preview'))

    def test_sample_area_near_kyoto_station(self):
        kiyomizu = places.trip_point({'text': '清水寺', 'name': '清水寺', 'lat': 34.9949, 'lng': 135.7850})
        got = app.first_preview(None, places.trip_of(kiyomizu), 'ja')
        self.assertEqual(got['area'], '京都')
        self.assertTrue(all(p.get('photo') for p in got['places'] if p['group'] == 'famous'))
        self.assertEqual([p['group'] for p in got['places']], ['famous'] * 3 + ['food', 'cafe'])
        self.assertIsNone(app.first_preview(None, places.trip_of(ICHIGAYA), 'ja'))
        self.assertEqual(app.first_preview(None, places.trip_of(KYOTO), 'en')['area'], 'Kyoto')

    def test_tag_changes_when_preview_arrives(self):
        job = {'version': 1, 'state': 'running', 'steps': []}
        before = app.job_tag(job)
        job['preview'] = {'area': 'a', 'places': [spot('A')]}
        self.assertNotEqual(app.job_tag(job), before)


if __name__ == '__main__':
    unittest.main()
