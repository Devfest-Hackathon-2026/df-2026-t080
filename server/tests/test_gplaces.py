# Places の呼び出しの枠と照合の試験（本物の Places は呼ばない）。cd server && python3 -m unittest discover -s tests
import os, sys, time, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import gplaces  # noqa: E402

AREA = {'name': '京都', 'lat': 35.0, 'lng': 135.75, 'radius': 10.0}


def spot(name, lat=35.0, lng=135.75, **kw):
    return {'id': 'p' + name, 'name': name, 'lat': lat, 'lng': lng, **kw}


class HoursText(unittest.TestCase):
    def test_english_hours_become_24_hour(self):
        nb, th = '\u202f', '\u2009'
        self.assertEqual(gplaces._hours_text_en(f'9:00{nb}AM{th}–{th}5:00{nb}PM'), '9:00–17:00')
        self.assertEqual(gplaces._hours_text_en(f'8:30{th}–{th}11:30{nb}AM, 1:00{th}–{th}5:00{nb}PM'), '8:30–11:30, 13:00–17:00')
        self.assertEqual(gplaces._hours_text_en(f'6:00{nb}PM{th}–{th}12:00{nb}AM'), '18:00–0:00')
        self.assertEqual(gplaces._hours_text_en(f'12:00{th}–{th}5:00{nb}PM'), '12:00–17:00')
        self.assertEqual(gplaces._hours_text_en('Open 24 hours'), 'Open 24 hours')
        self.assertEqual(gplaces._hours_text_en('Closed'), 'Closed')

    def test_japanese_hours(self):
        self.assertEqual(gplaces._hours_text('9時00分～17時00分'), '9:00〜17:00')


class Budget(unittest.TestCase):
    def setUp(self):
        self.saved = (gplaces.PER_HOUR, gplaces.BULK_PER_HOUR, gplaces.PER_DAY, gplaces.BULK_PER_DAY)
        gplaces.PER_HOUR, gplaces.BULK_PER_HOUR, gplaces.PER_DAY, gplaces.BULK_PER_DAY = 6, 2, 0, 0
        gplaces._times.clear()

    def tearDown(self):
        gplaces.PER_HOUR, gplaces.BULK_PER_HOUR, gplaces.PER_DAY, gplaces.BULK_PER_DAY = self.saved
        gplaces._times.clear()

    def test_day_limit_counts_calls_older_than_an_hour(self):
        gplaces.PER_DAY, gplaces.BULK_PER_DAY = 8, 3
        old = time.time() - 2 * 3600
        gplaces._times[:] = [(old, True)] * 3 + [(old, False)] * 4
        self.assertFalse(gplaces._take('search'))            # 1 日の照合の枠に届いている
        self.assertTrue(gplaces._take('details'))
        self.assertFalse(gplaces._take('details'))           # 1 日の上限に届いた

    def test_calls_older_than_a_day_are_dropped(self):
        gplaces.PER_DAY, gplaces.BULK_PER_DAY = 2, 1
        gplaces._times[:] = [(time.time() - 90000, True)] * 5
        self.assertTrue(gplaces._take('search'))

    def test_bulk_cannot_use_the_share_for_viewing(self):
        got = [gplaces._take('search') for _ in range(4)]
        self.assertEqual(got, [True, True, False, False])
        self.assertTrue(all(gplaces._take(k) for k in ('details', 'photo', 'details', 'photo')))
        self.assertFalse(gplaces._take('details'))

    def test_viewing_can_use_the_whole_hour(self):
        self.assertTrue(all(gplaces._take('photo') for _ in range(6)))
        self.assertFalse(gplaces._take('photo'))
        self.assertFalse(gplaces._take('search'))

    def test_no_limit(self):
        gplaces.PER_HOUR = 0
        self.assertTrue(all(gplaces._take('search') for _ in range(20)))


class ListBudget(unittest.TestCase):
    def setUp(self):
        self.saved = (gplaces.PER_HOUR, gplaces.BULK_PER_HOUR, gplaces.PER_DAY, gplaces.BULK_PER_DAY,
                      gplaces.LIST_PER_HOUR, gplaces.LIST_PER_DAY, dict(gplaces.COUNT), dict(gplaces.DENIED))
        gplaces.PER_HOUR, gplaces.BULK_PER_HOUR, gplaces.PER_DAY, gplaces.BULK_PER_DAY = 6, 2, 0, 0
        gplaces.LIST_PER_HOUR, gplaces.LIST_PER_DAY = 3, 5
        gplaces._times.clear()
        gplaces._list_times.clear()

    def tearDown(self):
        (gplaces.PER_HOUR, gplaces.BULK_PER_HOUR, gplaces.PER_DAY, gplaces.BULK_PER_DAY,
         gplaces.LIST_PER_HOUR, gplaces.LIST_PER_DAY) = self.saved[:6]
        gplaces.COUNT.update(self.saved[6])
        gplaces.DENIED.update(self.saved[7])
        gplaces._times.clear()
        gplaces._list_times.clear()

    def test_list_has_its_own_hour_and_does_not_use_the_viewing_share(self):
        got = [gplaces._take_list(k) for k in ('thumb', 'thumb_photo', 'thumb', 'thumb_photo')]
        self.assertEqual(got, [True, True, True, False])
        self.assertEqual(gplaces._times, [])
        self.assertTrue(all(gplaces._take(k) for k in ('details', 'photo') * 3))

    def test_counts_and_refusals_by_kind(self):
        before = dict(gplaces.COUNT), dict(gplaces.DENIED)
        for _ in range(4):
            gplaces._take_list('thumb')
        self.assertEqual(gplaces.COUNT['thumb'] - before[0]['thumb'], 3)
        self.assertEqual(gplaces.DENIED['thumb'] - before[1]['thumb'], 1)
        self.assertEqual(gplaces.COUNT['details'], before[0]['details'])

    def test_list_day_limit(self):
        old = time.time() - 2 * 3600
        gplaces._list_times[:] = [old] * 4
        self.assertTrue(gplaces._take_list('thumb'))
        self.assertFalse(gplaces._take_list('thumb'))
        gplaces._list_times[:] = [time.time() - 90000] * 9
        self.assertTrue(gplaces._take_list('thumb'))

    def test_viewing_limit_stops_the_list_too(self):
        self.assertTrue(all(gplaces._take('details') for _ in range(6)))
        self.assertFalse(gplaces._take_list('thumb'))
        self.assertEqual(gplaces._list_times, [])

    def test_no_list_limit(self):
        gplaces.LIST_PER_HOUR, gplaces.LIST_PER_DAY = 0, 0
        self.assertTrue(all(gplaces._take_list('thumb_photo') for _ in range(20)))


class Thumb(unittest.TestCase):
    def setUp(self):
        self.saved = gplaces._call
        self.asked = []

    def tearDown(self):
        gplaces._call = self.saved

    def fake(self, answer):
        def call(kind, path, query=None, body=None, fields=''):
            self.asked.append((kind, path, query, fields))
            return answer
        gplaces._call = call

    def test_asks_only_for_photos_and_gives_the_first(self):
        name = 'places/ChIJ' + 'a' * 20 + '/photos/' + 'b' * 40
        self.fake({'photos': [{'name': 'bad name'},
                              {'name': name, 'widthPx': 4000, 'heightPx': 3000,
                               'authorAttributions': [{'displayName': '投稿者', 'uri': '//maps.google.com/maps/contrib/1'}, {'displayName': ''}]},
                              {'name': name + 'c'}]})
        got = gplaces.thumb('ChIJ' + 'a' * 20)
        self.assertEqual(self.asked, [('thumb', 'places/ChIJ' + 'a' * 20, None, 'photos')])
        self.assertEqual(got, {'photo': {'name': name, 'width': 4000, 'height': 3000,
                                         'authors': [{'name': '投稿者', 'uri': 'https://maps.google.com/maps/contrib/1'}]}})

    def test_no_photo_and_missing_place(self):
        self.fake({})
        self.assertEqual(gplaces.thumb('ChIJ' + 'a' * 20), {'photo': None})
        self.fake(None)
        self.assertIsNone(gplaces.thumb('ChIJ' + 'a' * 20))
        self.assertIsNone(gplaces.thumb('../x'))
        self.assertEqual(len(self.asked), 2)

    def test_photo_from_the_list_is_counted_as_list(self):
        self.fake({'photoUri': 'https://lh3.example.com/p'})
        name = 'places/ChIJ' + 'a' * 20 + '/photos/' + 'b' * 40
        self.assertEqual(gplaces.photo_uri(name, 960, 'thumb_photo'), 'https://lh3.example.com/p')
        self.assertEqual(gplaces.photo_uri(name, 960), 'https://lh3.example.com/p')
        self.assertEqual([k for k, *_ in self.asked], ['thumb_photo', 'photo'])


class Locate(unittest.TestCase):
    def setUp(self):
        self.saved = (gplaces.PROJECT, gplaces.search, gplaces.location, dict(gplaces._known))
        gplaces._missed.clear()
        gplaces.PROJECT = 'test'
        gplaces._known.clear()
        self.asked = []

        def search(query, center, radius, kind='search'):
            name = query.rsplit(' ', 1)[0]
            self.asked.append(name)
            if len(self.asked) > self.room:
                raise gplaces.Off('limit')
            return [{'id': 'G' + 'x' * 12 + str(len(self.asked)), 'name': name, 'lat': 35.001, 'lng': 135.751}]
        gplaces.search = search
        gplaces.location = lambda pid: (35.002, 135.752)
        self.room = 99

    def tearDown(self):
        gplaces.PROJECT, gplaces.search, gplaces.location = self.saved[:3]
        gplaces._known.clear()
        gplaces._known.update(self.saved[3])

    def test_plan_like_places_first_and_rest_left_for_later(self):
        plist = [spot('隠れ1', role='hidden'), spot('店1', role='hidden', source='food'),
                 spot('有名2', role='famous', popularity=3), spot('希望1', source='wish', role='hidden'),
                 spot('有名1', role='famous', popularity=5)]
        self.room = 3
        gplaces.WORKERS = 1
        try:
            stat = gplaces.locate(plist, AREA)
        finally:
            gplaces.WORKERS = 6
        self.assertEqual(self.asked[:3], ['希望1', '有名1', '有名2'])
        self.assertEqual(stat['found'], 3)
        self.assertEqual(stat['left'], 2)
        left = [p for p in plist if not p.get('placeId')]
        self.assertTrue(all('placeMiss' not in p for p in left))   # 次の機会にまた照合する

    def test_known_place_id_is_used_without_calling(self):
        gplaces.learn([spot('清水寺', placeId='ChIJ' + 'a' * 20)])
        plist = [spot('清水寺', lat=35.01), spot('遠くの清水寺', lat=35.2), spot('別の寺')]
        stat = gplaces.locate(plist, AREA)
        self.assertEqual(plist[0]['placeId'], 'ChIJ' + 'a' * 20)
        self.assertNotIn('locatedAt', plist[0])                      # Google の位置は付けない
        self.assertEqual(stat['known'], 1)
        self.assertEqual(sorted(self.asked), ['別の寺', '遠くの清水寺'])

    def test_far_known_place_is_not_used(self):
        gplaces.learn([spot('清水寺', placeId='ChIJ' + 'a' * 20)])
        plist = [spot('清水寺', lat=35.05)]                           # 5 km 以上離れている
        gplaces.locate(plist, AREA)
        self.assertNotEqual(plist[0].get('placeId'), 'ChIJ' + 'a' * 20)

    def test_learn_keeps_own_position_not_google(self):
        p = spot('金閣寺', lat=35.0005, lng=135.7505)
        gplaces.locate([p], AREA)
        self.assertTrue(p['locatedAt'])
        key = gplaces.places.norm_name('金閣寺')
        self.assertEqual(gplaces._known[key][0][1:], (35.0005, 135.7505))   # 照合の前の位置

    def test_seeded_place_is_not_renewed(self):
        gplaces.learn([spot('清水寺', placeId='ChIJ' + 'a' * 20)])
        plist = [spot('清水寺')]
        gplaces.locate(plist, AREA)
        self.asked.clear()
        stat = gplaces.locate(plist, AREA)
        self.assertEqual((stat['renew'], stat['search']), (0, 0))

    def test_find_uses_viewing_share_and_remembers(self):
        p = spot('南禅寺')
        self.assertTrue(gplaces.find(p, AREA))
        self.assertTrue(gplaces.find(dict(p), AREA))
        self.assertEqual(self.asked, ['南禅寺'])                    # 2 回目は覚えた place_id

    def test_find_does_not_ask_again_for_a_missing_place(self):
        gplaces.search = lambda q, c, r, kind='search': self.asked.append(kind) or []
        p = spot('どこにもない店')
        self.assertIsNone(gplaces.find(p, AREA))
        self.assertIsNone(gplaces.find(p, AREA))
        self.assertEqual(self.asked, ['find'])


if __name__ == '__main__':
    unittest.main()


class NotSight(unittest.TestCase):
    def hit(self, types, label=''):
        return {'id': 'G' + 'x' * 12, 'name': 'チケットキャビン 大阪駅前第2ビル店', 'types': types, 'label': label}

    def test_ticket_shop_or_office_is_not_a_hidden_sight(self):
        p = spot('チケットキャビン', kind='sight', role='hidden')
        self.assertTrue(gplaces.not_sight(p, self.hit(['store', 'point_of_interest'], '金券ショップ')))
        self.assertTrue(gplaces.not_sight(p, self.hit(['convenience_store', 'store'])))
        self.assertTrue(gplaces.not_sight(p, self.hit(['corporate_office'])))

    def test_sights_shops_and_wishes_stay(self):
        p = spot('扇子の老舗', kind='sight', role='hidden')
        self.assertFalse(gplaces.not_sight(p, {'name': '扇子の老舗', 'types': ['store', 'point_of_interest'], 'label': '店'}))
        self.assertFalse(gplaces.not_sight(p, self.hit(['bank', 'historical_landmark'])))
        self.assertFalse(gplaces.not_sight(p, self.hit(['lodging', 'spa'])))
        self.assertFalse(gplaces.not_sight(spot('有名', kind='sight', role='famous'), self.hit(['department_store'])))
        self.assertFalse(gplaces.not_sight(spot('名指し', kind='sight', role='hidden', named=True), self.hit(['department_store'])))
        self.assertFalse(gplaces.not_sight(spot('店', role='hidden', kind='food'), self.hit(['convenience_store'])))

    def test_locate_marks_shop_found_by_search(self):
        saved = (gplaces.PROJECT, gplaces.search)
        gplaces.PROJECT = 'test'
        gplaces._known.clear()
        gplaces.search = lambda q, c, r, kind='search': [{'id': 'G' + 'y' * 12, 'name': q.rsplit(' ', 1)[0], 'lat': 35.001, 'lng': 135.751,
                                                          'types': ['atm', 'bank'], 'label': ''}]
        try:
            plist = [spot('両替の窓口', kind='sight', role='hidden'), spot('有名な寺', kind='sight', role='famous')]
            gplaces.locate(plist, AREA)
        finally:
            gplaces.PROJECT, gplaces.search = saved
            gplaces._known.clear()
        self.assertTrue(plist[0].get('notSight'))
        self.assertNotIn('notSight', plist[1])


class Closed(unittest.TestCase):
    """臨時休業・閉業と分かった場所は、候補の印を付ける（希望に名前を書いた場所は外さない）"""

    def locate(self, status, **extra):
        saved = (gplaces.PROJECT, gplaces.search)
        gplaces.PROJECT = 'test'
        gplaces._known.clear()
        gplaces.search = lambda q, c, r, kind='search': [{'id': 'G' + 'z' * 12, 'name': q.rsplit(' ', 1)[0], 'lat': 35.001, 'lng': 135.751,
                                                          'types': ['observation_deck'], 'label': '', 'status': status}]
        try:
            plist = [spot('展望フロア', kind='sight', role='famous', **extra)]
            gplaces.locate(plist, AREA)
        finally:
            gplaces.PROJECT, gplaces.search = saved
            gplaces._known.clear()
        return plist[0]

    def test_temporarily_or_permanently_closed_is_marked(self):
        self.assertTrue(self.locate('CLOSED_TEMPORARILY').get('closed'))
        self.assertTrue(self.locate('CLOSED_PERMANENTLY').get('closed'))

    def test_open_unknown_and_named_stay(self):
        self.assertNotIn('closed', self.locate('OPERATIONAL'))
        self.assertNotIn('closed', self.locate(''))
        self.assertNotIn('closed', self.locate('FUTURE_OPENING'))
        self.assertNotIn('closed', self.locate('CLOSED_TEMPORARILY', named=True))

    def test_search_reads_business_status(self):
        saved = gplaces._call
        gplaces._call = lambda kind, path, body=None, fields=None, query=None: {'places': [
            {'id': 'G' + 'a' * 12, 'location': {'latitude': 35.0, 'longitude': 135.75}, 'displayName': {'text': '展望フロア'}, 'businessStatus': 'CLOSED_TEMPORARILY'},
            {'id': 'G' + 'b' * 12, 'location': {'latitude': 35.0, 'longitude': 135.75}, 'displayName': {'text': '庭園'}}]}
        try:
            hits = gplaces.search('展望フロア', (35.0, 135.75), 3000)
        finally:
            gplaces._call = saved
        self.assertEqual([h['status'] for h in hits], ['CLOSED_TEMPORARILY', ''])
        self.assertIn('places.businessStatus', gplaces.SEARCH_FIELDS)


class GenericNamePart(unittest.TestCase):
    """「麺や 庄の」のような名前を、業種の言葉や短い語だけで別の店と取り違えない"""

    def test_variants_skip_generic_or_short_word(self):
        import places
        self.assertEqual(places.name_variants('麺や 庄の', '市ヶ谷 市ヶ谷'), ['麺や 庄の'])
        self.assertEqual(places.name_variants('カフェ 木漏れ日', '鎌倉'), ['カフェ 木漏れ日', '木漏れ日'])

    def test_variants_keep_distinct_long_word(self):
        import places
        self.assertIn('雲龍院', places.name_variants('長照山 雲龍院', '京都'))

    def test_pick_does_not_take_other_shop_with_same_generic_word(self):
        p = {'name': '麺や 庄の', 'lat': 35.0, 'lng': 135.75}
        hits = [{'id': 'other', 'name': '麺や 七彩', 'lat': 35.001, 'lng': 135.75}]
        self.assertIsNone(gplaces._pick(p, AREA, hits))

    def test_pick_takes_same_shop(self):
        p = {'name': '麺や 庄の', 'lat': 35.0, 'lng': 135.75}
        hits = [{'id': 'other', 'name': '麺や 七彩', 'lat': 35.0005, 'lng': 135.75},
                {'id': 'mine', 'name': '麺や 庄の 市ヶ谷店', 'lat': 35.002, 'lng': 135.75}]
        self.assertEqual(gplaces._pick(p, AREA, hits)['id'], 'mine')
