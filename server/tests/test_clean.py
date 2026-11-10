# 候補・条件・乗換の返事（Gemini）を確かめる係の試験。cd server && python3 -m unittest discover -s tests
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import places, transit  # noqa: E402

PLACE = {'name': '南禅寺', 'lat': 35.011, 'lng': 135.794, 'kind': 'sight', 'tags': ['寺社', '庭'], 'crowd': [1, 2, 3], 'stay': 60}


class PlaceTest(unittest.TestCase):
    def test_usual_place(self):
        p = places.clean_place(PLACE, 'famous')
        self.assertEqual((p['tags'], p['crowd'][:3], p['stay']), (['寺社', '庭'], [1, 2, 3], 60))

    def test_unknown_hours_are_all_day(self):
        for odd in ({}, {'open': None, 'close': ''}, {'open': 'x', 'close': 9}):
            p = places.clean_place({**PLACE, **odd}, 'famous')
            self.assertEqual((p['open'], p['close']), (0, 1440), odd)
        p = places.clean_place({**PLACE, 'open': '9:30', 'close': '17:00'}, 'famous')
        self.assertEqual((p['open'], p['close']), (570, 1020))

    def test_marks_filled_values(self):
        full = {**PLACE, 'crowd': list(range(5)) + [4] * 6, 'stay': 60, 'weekday_drop': 0, 'open': '9:00', 'close': '17:00'}
        self.assertNotIn('filled', places.clean_place(full, 'famous'))
        p = places.clean_place({**full, 'crowd': [1, 'x', 3, None, True, float('inf')]}, 'famous')
        self.assertEqual(p['filled'], {'crowd': [1, 3, 4, 5, 6, 7, 8, 9, 10]})
        self.assertEqual(p['crowd'], [1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1])
        p = places.clean_place({**PLACE, 'close': '17:00'}, 'famous')
        self.assertEqual(p['filled'], {'crowd': list(range(3, 11)), 'weekdayDrop': True, 'hours': True})
        self.assertEqual((p['stay'], p['weekdayDrop'], p['open'], p['close']), (60, 1, 0, 1020))
        p = places.clean_place({**full, 'stay': '長め', 'weekday_drop': True}, 'famous')
        self.assertEqual(p['filled'], {'stay': True, 'weekdayDrop': True})
        self.assertEqual((p['stay'], p['weekdayDrop']), (40, 1))
        self.assertNotIn('filled', places.clean_place({**full, 'stay': '60'}, 'famous'))
        self.assertEqual(places.clean_place({**full, 'crowd': ['2'] + full['crowd'][1:]}, 'famous')['filled'], {'crowd': [0]})

    def test_odd_numbers_and_shapes(self):
        self.assertIsNone(places.clean_place({**PLACE, 'lat': 10 ** 400}, 'famous'))
        for tags in (5, None, {'寺社': 1}, '寺社'):
            self.assertEqual(places.clean_place({**PLACE, 'tags': tags}, 'famous')['tags'], [], tags)
        p = places.clean_place({**PLACE, 'tags': [['寺社'], '庭'], 'crowd': [10 ** 400, float('inf'), -3, True], 'stay': 1e999}, 'famous')
        self.assertEqual((p['tags'], p['crowd'][:4], p['stay']), (['庭'], [1, 1, 0, 1], 40))

    def test_area_and_conditions_shapes(self):
        a = places.clean_area({'area': ['京都'], 'start': 'x', 'districts': 7}, '京都')
        self.assertEqual((a['area']['name'], a['districts']), ('京都', []))
        self.assertEqual(places.clean_conditions({'conditions': 3}), [])
        self.assertEqual(places.clean_conditions({'conditions': [{'tag': '静か', 'label': '静かな所'}]}), [{'tag': '静か', 'label': '静かな所'}])


class TransitTest(unittest.TestCase):
    def test_steps_must_be_a_list(self):
        self.assertIsNone(transit.clean({'found': True, 'steps': 5, 'total_minutes': 20}))
        r = transit.clean({'found': True, 'steps': [{'mode': 'train', 'minutes': 1e999}, 'x'], 'total_minutes': 25})
        self.assertEqual((r['minutes'], r['steps'][0]['minutes'], len(r['steps'])), (25, 0, 1))


if __name__ == '__main__':
    unittest.main()
