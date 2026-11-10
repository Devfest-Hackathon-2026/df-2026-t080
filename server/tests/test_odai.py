# odai.py の試験。cd server && python3 -m unittest discover -s tests
import os, random, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import odai  # noqa: E402


class BuildPromptTest(unittest.TestCase):
    def body(self, **kw):
        b = {'area': '鎌倉', 'kind': '公園・自然', 'level': 'easy', 'date': '11月7日（土）', 'time': '16:54',
             'examples': ['足元の葉っぱを1枚選び、葉の筋に近づいて撮る'],
             'place': {'name': '長谷寺', 'district': '長谷', 'why': '花の寺です。', 'tags': ['寺社', '花']}}
        b.update(kw)
        return b

    def test_asks_one_close_photo(self):
        p = odai.build_prompt(self.body())
        self.assertIn('近づいて 1 枚だけ撮る', p)
        self.assertIn('撮るのは 1 枚だけ', p)
        self.assertIn('見る所も 1 つに絞る', p)
        self.assertIn('- 足元の葉っぱを1枚選び、葉の筋に近づいて撮る', p)
        self.assertIn('返す形: {"text":"お題"}', p)

    def test_avoid_lists_past_odai(self):
        p = odai.build_prompt(self.body(avoid=['灯籠に刻まれた文字を1つ見つけて、近づいて撮る']))
        self.assertIn('前に出したお題:\n- 灯籠に刻まれた文字を1つ見つけて、近づいて撮る', p)
        self.assertNotIn('前に出したお題:', odai.build_prompt(self.body()))

    def test_gives_one_angle(self):
        p = odai.build_prompt(self.body(), rng=random.Random(1))
        self.assertIn('今回の切り口:', p)
        self.assertEqual(sum(1 for a in odai.ANGLES if f'今回の切り口: {a[0]}' in p), 1)

    def test_angle_varies(self):
        seen = {odai.pick_angle([], random.Random(i))[0] for i in range(40)}
        self.assertGreaterEqual(len(seen), 4)

    def test_reroll_avoids_past_angle(self):
        past = ['灯籠に刻まれた文字を1つ見つけて、近づいて撮る']
        for i in range(40):
            self.assertNotEqual(odai.pick_angle(past, random.Random(i))[0], '文字や数字')

    def test_all_angles_used_falls_back(self):
        past = [' '.join(w for a in odai.ANGLES for w in a[1])]
        self.assertIn(odai.pick_angle(past, random.Random(0)), odai.ANGLES)

    def test_clean(self):
        self.assertEqual(odai.clean({'text': ' 貝殻を1つ選び、\n すじを撮る '}), '貝殻を1つ選び、 すじを撮る')
        self.assertEqual(odai.clean({}), '')



class SafetyTest(unittest.TestCase):
    CUT = {'area': '鎌倉', 'kind': '公園・自然', 'level': 'normal', 'date': '11月9日（日）', 'time': '10:30',
           'examples': ['足元の葉っぱを1枚選び、葉の筋に近づいて撮る', '一番大きな木を1本選び、幹の色を撮る'],
           'place': {'name': '釈迦堂切通し', 'district': '大町', 'why': '岩肌を削った古道です。', 'tags': ['歴史', '散策']}}

    def test_risky_place_prompt_forbids_getting_close(self):
        p = odai.build_prompt(self.CUT, rng=random.Random(0))
        self.assertIn('道から見て 1 枚だけ撮る', p)
        self.assertNotIn('近づいて 1 枚だけ撮る', p)
        self.assertIn('近づかせない', p)
        self.assertIn('足場が悪い所や危ない所を含むかもしれない', p)
        self.assertNotIn('葉の筋に近づいて撮る', p)
        self.assertIn('- 一番大きな木を1本選び、幹の色を撮る', p)

    def test_every_prompt_has_safety_rules(self):
        p = odai.build_prompt(BuildPromptTest().body())
        self.assertIn('物に触る・よじ登る・柵や縄を越える', p)
        self.assertIn('切通し・崖・滝・山道・岩場', p)
        self.assertNotIn('足場が悪い所や危ない所を含むかもしれない', odai.build_prompt({**self.CUT, 'place': {'name': '鶴岡八幡宮', 'tags': ['寺社']}}))

    def test_risky_detects_words_and_tags(self):
        self.assertTrue(odai.risky(self.CUT))
        self.assertTrue(odai.risky({'place': {'name': '華厳滝'}}))
        self.assertTrue(odai.risky({'place': {'name': '由比ヶ浜海岸', 'district': '由比ヶ浜', 'why': '海辺です。', 'tags': ['海', '景色']}}))
        self.assertTrue(odai.risky({'place': {'name': 'Shakado Pass', 'why': 'An old road cut through the rock.'}}))
        self.assertFalse(odai.risky({'place': {'name': '兼六園', 'district': '金沢'}}))
        self.assertFalse(odai.risky({'place': {'name': '横浜中華街', 'district': '横浜'}}))
        self.assertFalse(odai.risky({'place': {'name': '海辺の食堂', 'kind': 'food', 'tags': ['海']}}))

    def test_clean_replaces_close_wording_at_risky_place(self):
        out = odai.clean({'text': '岩肌を削った跡を 1 か所選び、近づいて撮る'}, 'ja', self.CUT, random.Random(0))
        self.assertIn(out, odai.SAFE['ja'])
        en = odai.clean({'text': 'Pick one chisel mark on the rock wall and take a close-up.'}, 'en',
                        {**self.CUT, 'lang': 'en'}, random.Random(0))
        self.assertIn(en, odai.SAFE['en'])

    def test_clean_replaces_touch_and_climb_anywhere(self):
        temple = {'place': {'name': '鶴岡八幡宮', 'tags': ['寺社']}}
        self.assertIn(odai.clean({'text': '石段に登って、すり減った所を撮る'}, 'ja', temple), odai.SAFE['ja'])
        self.assertIn(odai.clean({'text': '大イチョウの幹に触れて、木の肌を撮る'}, 'ja', temple), odai.SAFE['ja'])
        self.assertEqual(odai.clean({'text': '灯籠に刻まれた文字を1つ見つけて、近づいて撮る'}, 'ja', temple),
                         '灯籠に刻まれた文字を1つ見つけて、近づいて撮る')

    def test_safe_text_avoids_past(self):
        past = odai.SAFE['ja'][:2]
        for i in range(10):
            self.assertEqual(odai.safe_text('ja', past, random.Random(i)), odai.SAFE['ja'][2])


if __name__ == '__main__':
    unittest.main()
