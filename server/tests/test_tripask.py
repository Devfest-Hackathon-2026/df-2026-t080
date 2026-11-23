# 泊まりの旅の 1 行の文を読み取る係（tripask.py と /api/trip-ask）の試験。cd server && python3 -m unittest discover -s tests
import datetime, json, os, sys, threading, unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import app, places, tripask  # noqa: E402

TODAY = datetime.date(2026, 11, 19)


def clean(raw):
    return tripask.clean(raw, TODAY)


class CleanTest(unittest.TestCase):
    def test_usual_answer_is_kept(self):
        raw = places.parse_json('```json\n' + json.dumps({
            'from': '京都', 'nights': 2, 'date': '2026-11-21', 'stays': ['四条', '嵐山'], 'wish': '静かな寺を回りたい',
            'days': [{'start': '10:00'}, {'wish': '嵐山を回りたい'}, {'end': '17:00'}]}, ensure_ascii=False) + '\n```')
        self.assertEqual(clean(raw), {'from': '京都', 'nights': 2, 'date': '2026-11-21', 'stays': ['四条', '嵐山'], 'wish': '静かな寺を回りたい',
                                      'days': [{'start': 600}, {'wish': '嵐山を回りたい'}, {'end': 1020}]})

    def test_missing_items_are_not_filled(self):
        self.assertEqual(clean({'from': '金沢'}), {'from': '金沢'})
        self.assertEqual(clean({'from': '', 'wish': '  ', 'stays': [], 'days': [{}, {}], 'end': None}), {})

    def test_four_nights_or_more_is_marked(self):
        self.assertEqual(clean({'nights': 4}), {'over': True})
        self.assertEqual(clean({'over': True}), {'over': True})
        self.assertEqual(clean({'nights': 3}), {'nights': 3})
        self.assertEqual(clean({'nights': 2.0}), {'nights': 2})
        for bad in (0, -1, '2', True, 2.5, None, [2]):
            self.assertEqual(clean({'nights': bad}), {}, bad)

    def test_dates_in_the_past_or_too_far_are_dropped(self):
        self.assertEqual(clean({'date': '2026-11-19'}), {'date': '2026-11-19'})
        self.assertEqual(clean({'date': '2027-11-20'}), {'date': '2027-11-20'})
        for bad in ('2026-11-18', '2027-11-21', '2026-02-30', '11/21', 20261121, '2026-11-21T00:00'):
            self.assertEqual(clean({'date': bad}), {}, bad)

    def test_times_out_of_range_are_dropped(self):
        self.assertEqual(clean({'days': [{'start': '4:59', 'end': '24:00'}, {'end': '9:75'}]}), {})
        self.assertEqual(clean({'days': [{'start': '05:00'}, {}, {'end': '23:55'}]}), {'days': [{'start': 300}, {}, {'end': 1435}]})
        self.assertEqual(clean({'days': [{'start': 600}]}), {})

    def test_stays_keep_null_for_same_as_before(self):
        self.assertEqual(clean({'stays': ['四条', None, None]}), {'stays': ['四条']})
        self.assertEqual(clean({'stays': [None, '嵐山']}), {'stays': [None, '嵐山']})
        self.assertEqual(clean({'stays': ['a', 'b', 'c', 'd']}), {'stays': ['a', 'b', 'c']})
        self.assertEqual(clean({'stays': [None, '']}), {})

    def test_back_means_end_at_start(self):
        self.assertEqual(clean({'back': True, 'end': '嵐山駅'}), {'end': None})
        self.assertEqual(clean({'end': '嵐山駅'}), {'end': '嵐山駅'})
        self.assertEqual(clean({'back': 'yes'}), {})

    def test_long_texts_are_cut(self):
        got = clean({'from': 'あ' * 100, 'wish': 'い' * 300, 'days': [{'wish': 'う' * 300}]})
        self.assertEqual(len(got['from']), tripask.NAME_MAX)
        self.assertEqual(len(got['wish']), tripask.WISH_MAX)
        self.assertEqual(len(got['days'][0]['wish']), tripask.WISH_MAX)

    def test_odd_shapes_do_not_break(self):
        for raw in ([], 'x', None, {'days': 'x'}, {'days': [5, None]}, {'stays': '四条'}, {'from': ['京都']}, {'wish': {'a': 1}}):
            self.assertEqual(clean(raw), {}, raw)


class PromptTest(unittest.TestCase):
    def test_prompt_has_today_summary_and_text(self):
        text = tripask.build_prompt({'text': 'やっぱり2泊目は嵐山', 'summary': {'from': '京都', 'nights': 2, 'stays': ['四条', None], 'days': [{'start': 600}]}}, TODAY)
        self.assertIn('2026-11-19（木）', text)
        self.assertIn('やっぱり2泊目は嵐山', text)
        self.assertIn('"stays": ["四条", null]', text)
        self.assertIn('"start": "10:00"', text)

    def test_prompt_for_english(self):
        text = tripask.build_prompt({'text': 'Kyoto, 2 nights', 'lang': 'en'}, TODAY)
        self.assertIn('2026-11-19（Thu）', text)
        self.assertIn('English screen', text)

    def test_today_from_the_screen_is_used_only_when_close(self):
        now = datetime.datetime(2026, 11, 19, 23, 30, tzinfo=datetime.timezone(datetime.timedelta(hours=9)))
        self.assertEqual(tripask.today_of('2026-11-20', now), datetime.date(2026, 11, 20))
        self.assertEqual(tripask.today_of('2026-12-20', now), datetime.date(2026, 11, 19))
        self.assertEqual(tripask.today_of('x', now), datetime.date(2026, 11, 19))


class FakeLlm:
    def __init__(self, answer):
        self.answer, self.calls = answer, 0

    def ask(self, prompt, model=''):
        self.calls += 1
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer

    def quota(self):
        return None


def post(port, body):
    import http.client
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    c.request('POST', '/api/trip-ask', data, {'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9'})
    r = c.getresponse()
    return r.status, json.loads(r.read() or b'{}')


class RouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), app.H)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self.saved = app.llm, app.LLM_RATE

    def tearDown(self):
        app.llm, app.LLM_RATE = self.saved

    def use(self, answer, per_client=10):
        fake = FakeLlm(answer)
        app.llm = app.Limited(fake, 0, 0)
        app.LLM_RATE = app.bus.Rate(per_client, 0)
        return fake

    def test_one_call_returns_the_diff(self):
        fake = self.use(json.dumps({'from': '京都', 'nights': 2, 'stays': ['四条', '嵐山']}, ensure_ascii=False))
        code, d = post(self.port, {'text': '京都に2泊3日', 'summary': {}, 'today': datetime.date.today().isoformat()})
        self.assertEqual(code, 200)
        self.assertEqual(d, {'diff': {'from': '京都', 'nights': 2, 'stays': ['四条', '嵐山']}})
        self.assertEqual(fake.calls, 1)

    def test_empty_and_long_texts_are_refused_without_calling(self):
        fake = self.use('{}')
        self.assertEqual(post(self.port, {'text': '  '}), (400, {'error': 'empty'}))
        self.assertEqual(post(self.port, {'text': 'あ' * (tripask.TEXT_MAX + 1)}), (400, {'error': 'long'}))
        self.assertEqual(fake.calls, 0)

    def test_per_client_limit_is_quota(self):
        self.use('{"from":"金沢"}', per_client=1)
        self.assertEqual(post(self.port, {'text': '金沢'})[1], {'diff': {'from': '金沢'}})
        self.assertEqual(post(self.port, {'text': '金沢'}), (200, {'error': 'quota'}))

    def test_failures(self):
        self.use(RuntimeError('枠: 1 時間あたりの Gemini の呼び出しの上限に届きました'))
        self.assertEqual(post(self.port, {'text': '金沢'}), (200, {'error': 'quota'}))
        self.use('返事が JSON ではない')
        self.assertEqual(post(self.port, {'text': '金沢'}), (200, {'error': 'failed'}))


if __name__ == '__main__':
    unittest.main()
