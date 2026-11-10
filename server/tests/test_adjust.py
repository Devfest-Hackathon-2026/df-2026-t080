# プランへの頼みの返事（Gemini）を確かめる係の試験。cd server && python3 -m unittest discover -s tests
import json, os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import adjust, places  # noqa: E402

BODY = {'places': [{'id': 'pa', 'district': '東山'}, {'id': 'pb', 'district': '嵐山'}, {'id': 'pc'}],
        'plan': [{'id': 'pa'}, {'id': 'pb'}]}


def ops(raw):
    return adjust.clean(raw, BODY)['ops']


class CleanTest(unittest.TestCase):
    def test_usual_ops_are_kept(self):
        raw = {'reply': '変えました。', 'ops': [
            {'op': 'add', 'id': 'pc'}, {'op': 'stay', 'id': 'pa', 'minutes': 47}, {'op': 'move', 'id': 'pc', 'to': 'before:pa'},
            {'op': 'time', 'start': '9:30', 'end': '18:00'}, {'op': 'cond', 'add': [{'tag': '静か', 'label': '静かな所'}], 'remove': ['海']},
            {'op': 'district', 'skip': ['嵐山']}, {'op': 'find', 'wish': '甘味', 'kind': 'cafe'}]}
        self.assertEqual(adjust.clean(raw, BODY), {'reply': '変えました。', 'ops': [
            {'op': 'add', 'id': 'pc'}, {'op': 'stay', 'id': 'pa', 'minutes': 45}, {'op': 'move', 'id': 'pc', 'to': 'before:pa'},
            {'op': 'time', 'start': 570, 'end': 1080}, {'op': 'cond', 'add': [{'tag': '静か', 'label': '静かな所'}], 'remove': ['海']},
            {'op': 'district', 'skip': ['嵐山'], 'use': []}, {'op': 'find', 'wish': '甘味', 'kind': 'cafe'}]})

    def test_overflowing_stay_skips_only_that_op(self):
        raw = places.parse_json('{"ops":[{"op":"stay","id":"pa","minutes":1e999},{"op":"remove","id":"pb"}]}')
        self.assertEqual(ops(raw), [{'op': 'remove', 'id': 'pb'}])
        for bad in (float('nan'), float('-inf'), '1e999', 10 ** 400, True, None, [30], {'m': 30}, 'abc'):
            self.assertEqual(ops({'ops': [{'op': 'stay', 'id': 'pa', 'minutes': bad}]}), [], bad)
        self.assertEqual(ops({'ops': [{'op': 'stay', 'id': 'pa', 'minutes': '1e300'}]}), [{'op': 'stay', 'id': 'pa', 'minutes': 240}])
        self.assertEqual(ops({'ops': [{'op': 'stay', 'id': 'pa', 'minutes': -5}]}), [{'op': 'stay', 'id': 'pa', 'minutes': 10}])

    def test_odd_shapes_do_not_break(self):
        for raw in ([], 'x', {'ops': 5}, {'ops': {'op': 'add'}}, {'ops': 'add'}, {'ops': [5, None, []]}):
            self.assertEqual(ops(raw), [], raw)
        odd = [{'op': 'district', 'skip': [['嵐山']], 'use': {'東山': 1}}, {'op': 'cond', 'add': 5, 'remove': [['海']]},
               {'op': 'cond', 'add': [{'tag': ['静か']}]}, {'op': 'move', 'id': 'pa', 'to': ['first']},
               {'op': 'add', 'id': ['pc']}, {'op': 'find', 'wish': {'a': 1}}, {'op': 'time', 'start': 930, 'end': ['18:00']}]
        self.assertEqual(ops({'ops': odd}), [])
        self.assertEqual(adjust.clean({'reply': {'a': 1}, 'ops': []}, BODY)['reply'], '変更できる所が見つかりませんでした。')

    def test_time_needs_real_minutes(self):
        self.assertEqual(ops({'ops': [{'op': 'time', 'start': '9:75', 'end': '18:00\n'}]}), [])
        self.assertEqual(ops({'ops': [{'op': 'time', 'start': '９:３０'}]}), [])
        self.assertEqual(ops({'ops': [{'op': 'time', 'start': '05:00'}]}), [{'op': 'time', 'start': 300}])

    def test_prefer_keeps_only_true_and_false(self):
        self.assertEqual(ops({'ops': [{'op': 'prefer', 'moveLess': True}]}), [{'op': 'prefer', 'moveLess': True}])
        self.assertEqual(ops({'ops': [{'op': 'prefer', 'calm': False}]}), [{'op': 'prefer', 'calm': False}])
        self.assertEqual(ops({'ops': [{'op': 'prefer', 'moveLess': False, 'calm': True}]}), [{'op': 'prefer', 'moveLess': False, 'calm': True}])
        for bad in ('true', 1, 0, None, [True], {'on': True}, 'false'):
            self.assertEqual(ops({'ops': [{'op': 'prefer', 'moveLess': bad, 'calm': bad}]}), [], bad)
        self.assertEqual(ops({'ops': [{'op': 'prefer', 'moveLess': 'yes', 'calm': True, 'pace': 'slow'}]}), [{'op': 'prefer', 'calm': True}])
        self.assertEqual(ops({'ops': [{'op': 'prefer'}]}), [])
        raw = places.parse_json('{"ops":[{"op":"prefer","moveLess":true},{"op":"time","end":"17:00"}]}')
        self.assertEqual(ops(raw), [{'op': 'prefer', 'moveLess': True}, {'op': 'time', 'end': 1020}])

    def test_prompt_tells_prefer_and_current_state(self):
        text = adjust.build_prompt({**BODY, 'request': '移動を少なく', 'prefer': {'moveLess': True, 'calm': 'x'}})
        self.assertIn('"op":"prefer"', text)
        self.assertIn('移動を少なくする（オン）・混雑をもっと避ける（オフ）', text)
        self.assertIn('prefer の moveLess:true', text)
        en = adjust.build_prompt({**BODY, 'request': 'Less travel', 'lang': 'en'})
        self.assertIn('prefer の moveLess', en.split('英語で書くこと')[1])
        self.assertIn('移動を少なくする（オフ）', adjust.build_prompt({**BODY, 'prefer': 'on'}))

    def test_prompt_tells_distance_from_plan(self):
        body = {'request': '昼食を安い店にして',
                'plan': [{'id': 'pa', 'name': '清水寺', 'lat': 34.9949, 'lng': 135.7850}],
                'places': [{'id': 'pa', 'name': '清水寺', 'lat': 34.9949, 'lng': 135.7850},
                           {'id': 'pn', 'name': '近い店', 'kind': 'food', 'lat': 34.9990, 'lng': 135.7850},
                           {'id': 'pf', 'name': '遠い店', 'kind': 'food', 'lat': 35.0290, 'lng': 135.7800},
                           {'id': 'px', 'name': '位置の無い店', 'kind': 'food', 'lat': 'x'}]}
        lines = {ln.split(']')[0][1:]: ln for ln in adjust.build_prompt(body).splitlines() if ln.startswith('[p')}
        self.assertIn('プランから0.5km', lines['pn'])
        self.assertIn('プランから3.8km', lines['pf'])
        self.assertNotIn('プランから', lines['pa'])
        self.assertNotIn('プランから', lines['px'])
        self.assertIn('頼みで触れていない場所は、足さない・外さない。', adjust.build_prompt(body))
        self.assertNotIn('プランから', adjust.build_prompt(BODY).split('候補（')[1].split('使える条件')[0])

    def test_round_trip_through_json(self):
        raw = places.parse_json(json.dumps({'reply': 'ok', 'ops': [{'op': 'stay', 'id': 'pb', 'minutes': 90}]}))
        self.assertEqual(ops(raw), [{'op': 'stay', 'id': 'pb', 'minutes': 90}])


if __name__ == '__main__':
    unittest.main()
