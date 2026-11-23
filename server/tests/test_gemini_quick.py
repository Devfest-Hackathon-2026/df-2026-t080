import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from google.genai import errors
    HAVE = True
except ImportError:
    HAVE = False

import gemini


class Res:
    def __init__(self, text):
        self.text = text


class Models:
    def __init__(self, owner):
        self.owner = owner

    def generate_content(self, **kw):
        ho = kw['config'].http_options
        self.owner.calls.append((ho.timeout if ho else None, gemini._client))
        a = self.owner.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return Res(a)


def api_error(code):
    e = errors.APIError.__new__(errors.APIError)
    e.code = code
    return e


@unittest.skipUnless(HAVE, 'google-genai が無い')
class AskQuick(unittest.TestCase):
    def setUp(self):
        self.old = gemini._get_client, gemini._client, gemini.before_send
        self.calls, self.answers, self.sent = [], [], 0
        self.models = Models(self)
        gemini._get_client = lambda: self

        def count():
            self.sent += 1
        gemini.before_send = count

    def tearDown(self):
        gemini._get_client, gemini._client, gemini.before_send = self.old

    def test_answer(self):
        self.answers = ['{}']
        self.assertEqual(gemini.ask_quick('p', 'm'), '{}')
        self.assertEqual(self.calls[0][0], 8000)
        self.assertEqual(self.sent, 1)

    def test_retry_after_deadline(self):
        self.answers = [api_error(504), '{"a": 1}']
        self.assertEqual(gemini.ask_quick('p', 'm'), '{"a": 1}')
        self.assertEqual([c[0] for c in self.calls], [8000, 15000])
        self.assertEqual(self.sent, 2)

    def test_retry_keeps_the_shared_client(self):
        shared = object()
        gemini._client = shared
        self.answers = [TimeoutError('t'), '{"a": 1}']
        self.assertEqual(gemini.ask_quick('p', 'm'), '{"a": 1}')
        self.assertIs(self.calls[1][1], shared)

    def test_closed_client_is_replaced_and_kept(self):
        gemini._get_client = self.old[0]
        closed = self
        gemini._client = closed
        made = []

        class Fresh:
            def __init__(inner):
                inner.models = Models(self)
                made.append(inner)
        import google.genai as genai_mod
        real = genai_mod.Client
        genai_mod.Client = lambda **kw: Fresh()
        try:
            self.answers = [RuntimeError('Cannot send a request, as the client has been closed.'), '{"a": 1}']
            self.assertEqual(gemini.ask_quick('p', 'm'), '{"a": 1}')
            self.assertEqual(len(made), 1)
            self.assertIs(gemini._client, made[0])
            self.assertIn(closed, gemini._retired)
            self.answers = [RuntimeError('client has been closed'), '{"b": 2}']
            gemini._client = closed
            self.assertEqual(gemini._generate(model='m', contents='p', config=gemini._config(0.4)).text, '{"b": 2}')
        finally:
            genai_mod.Client = real
            gemini._retired.clear()

    def test_fail_twice(self):
        self.answers = [api_error(504), api_error(504)]
        with self.assertRaises(gemini.Skip):
            gemini.ask_quick('p', 'm')

    def test_quota_is_not_retried(self):
        self.answers = [api_error(429)]
        with self.assertRaises(gemini.Skip) as c:
            gemini.ask_quick('p', 'm')
        self.assertIn('枠', str(c.exception))
        self.assertEqual(len(self.calls), 1)

    def test_bad_request_is_not_retried(self):
        self.answers = [api_error(400)]
        with self.assertRaises(gemini.Skip):
            gemini.ask_quick('p', 'm')
        self.assertEqual(len(self.calls), 1)


if __name__ == '__main__':
    unittest.main()
