# エリアの中心と範囲を、候補の位置から決め直す係の試験。cd server && python3 -m unittest discover -s tests
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import places  # noqa: E402

# 市ヶ谷・飯田橋のあたりの候補（本物の位置に近い作り物）
NEAR = [(35.6915, 139.7357), (35.7020, 139.7449), (35.6981, 139.7414), (35.6939, 139.7387), (35.7008, 139.7398),
        (35.6955, 139.7466), (35.6990, 139.7350), (35.7032, 139.7411)]


def area_data(lat, lng, radius=1.5, start=None):
    s = start or (lat, lng)
    return {'area': {'name': '市ヶ谷・飯田橋', 'lat': lat, 'lng': lng, 'radius': radius},
            'start': {'name': '飯田橋駅', 'lat': s[0], 'lng': s[1]}}


def plist(points):
    return [{'name': f'p{i}', 'lat': a, 'lng': b} for i, (a, b) in enumerate(points)]


class RecenterTest(unittest.TestCase):
    def test_wrong_longitude_is_fixed_from_places(self):
        # 本番で起きた形: 経度に緯度のような値（35.7441）が入っていた
        ad = area_data(35.6961, 35.7441)
        ps = plist(NEAR)
        self.assertTrue(places.recenter(ad, ps))
        self.assertTrue(places.in_japan(ad['area']['lat'], ad['area']['lng']))
        self.assertTrue(all(places.in_area(p, ad['area']) for p in ps))
        self.assertTrue(places.in_japan(ad['start']['lat'], ad['start']['lng']))

    def test_good_center_is_kept(self):
        ad = area_data(35.6980, 139.7410, start=(35.7020, 139.7449))
        before = dict(ad['area']), dict(ad['start'])
        self.assertFalse(places.recenter(ad, plist(NEAR)))
        self.assertEqual((ad['area'], ad['start']), before)

    def test_center_far_from_places_moves_and_widens(self):
        # 日本の中だが、候補の多くから外れている（中心が 20 km ほどずれている）
        ad = area_data(35.85, 139.60)
        ps = plist(NEAR)
        self.assertTrue(places.recenter(ad, ps))
        self.assertTrue(all(places.in_area(p, ad['area']) for p in ps))

    def test_too_few_places_do_nothing(self):
        ad = area_data(35.6961, 35.7441)
        self.assertFalse(places.recenter(ad, plist(NEAR[:2])))

    def test_places_outside_japan_are_ignored(self):
        ad = area_data(35.6961, 35.7441)
        ps = plist(NEAR + [(51.5, -0.12), (0.0, 0.0)])
        self.assertTrue(places.recenter(ad, ps))
        self.assertTrue(places.in_japan(ad['area']['lat'], ad['area']['lng']))
        self.assertLess(ad['area']['radius'], 5)


class AnchorTest(unittest.TestCase):
    # 本番で起きた形: Gemini が中心と食事の候補の経度を、139 ではなく 135 と書いた（見どころは正しい 139）
    def test_shift_back_with_anchor(self):
        ad = area_data(35.6917, 135.7365, start=(35.6917, 139.7365))
        shifted = plist([(a, b - 4.0) for a, b in NEAR[:4]])
        right = plist(NEAR[4:])
        ps = shifted + right
        self.assertTrue(places.recenter(ad, ps, (35.6930, 139.7370)))
        self.assertTrue(all(places.in_area(p, ad['area']) for p in ps))
        self.assertAlmostEqual(shifted[0]['lng'], NEAR[0][1], places=3)
        self.assertAlmostEqual(ad['start']['lng'], 139.7365, places=3)

    def test_anchor_close_keeps_center(self):
        ad = area_data(35.6980, 139.7410)
        self.assertFalse(places.recenter(ad, plist(NEAR), (35.6930, 139.7370)))
        self.assertEqual((ad['area']['lat'], ad['area']['lng']), (35.6980, 139.7410))

    def test_far_places_not_pulled_in(self):
        # ずらしても範囲に入らない候補（本当に遠い場所）は、そのまま（あとで範囲の外として落ちる）
        ad = area_data(35.6917, 135.7365)
        far = plist([(34.70, 135.50)])
        places.recenter(ad, far + plist(NEAR), (35.6930, 139.7370))
        self.assertEqual((far[0]['lat'], far[0]['lng']), (34.70, 135.50))

    def test_area_anchor_tries_first_word(self):
        calls = []

        def fake(q, box, cache):
            calls.append(q)
            return [('市谷', 35.6930, 139.7370)] if q == '市ヶ谷' else []
        real = places.nominatim
        places.nominatim = fake
        try:
            self.assertEqual(places.area_anchor('市ヶ谷　飯田橋', {}), (35.6930, 139.7370))
        finally:
            places.nominatim = real
        self.assertEqual(calls, ['市ヶ谷 飯田橋', '市ヶ谷'])


if __name__ == '__main__':
    unittest.main()
