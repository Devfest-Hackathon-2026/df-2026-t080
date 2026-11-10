# 画面に渡す設定（/api/config）の試験。cd server && python3 -m unittest discover -s tests
import json, os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import webconfig  # noqa: E402

GOOD = {'apiKey': 'AIzaSyTEST-key_123', 'authDomain': 'demo-intentrip.firebaseapp.com', 'projectId': 'demo-intentrip',
        'appId': '1:123456789:web:abcdef', 'messagingSenderId': '123456789', 'storageBucket': 'demo-intentrip.appspot.com'}


class WebConfigTest(unittest.TestCase):
    def test_no_env_means_no_firebase(self):
        self.assertEqual(webconfig.load({}), {'firebase': None})

    def test_good_config_passes_known_keys_only(self):
        got = webconfig.load({'ZT_FIREBASE_CONFIG': json.dumps({**GOOD, 'measurementId': 'G-XXXX', 'extra': 'x'})})
        self.assertEqual(got, {'firebase': GOOD})

    def test_missing_required_key_is_dropped(self):
        for k in webconfig.NEED:
            bad = {x: v for x, v in GOOD.items() if x != k}
            self.assertIsNone(webconfig.load({'ZT_FIREBASE_CONFIG': json.dumps(bad)})['firebase'], k)

    def test_broken_or_odd_values_are_dropped(self):
        for raw in ('', 'not json', '[]', json.dumps({**GOOD, 'apiKey': '<script>'}), json.dumps({**GOOD, 'projectId': 5})):
            self.assertIsNone(webconfig.load({'ZT_FIREBASE_CONFIG': raw})['firebase'], raw)

    def test_emulator_only_with_firebase_and_good_hosts(self):
        emu = json.dumps({'auth': 'http://127.0.0.1:9099', 'firestore': '127.0.0.1:8180'})
        self.assertEqual(webconfig.load({'ZT_FIREBASE_CONFIG': json.dumps(GOOD), 'ZT_FIREBASE_EMULATOR': emu})['emulator'],
                         {'auth': 'http://127.0.0.1:9099', 'firestore': '127.0.0.1:8180'})
        self.assertNotIn('emulator', webconfig.load({'ZT_FIREBASE_EMULATOR': emu}))
        bad = json.dumps({'auth': 'javascript:alert(1)', 'firestore': '127.0.0.1:8180'})
        self.assertNotIn('emulator', webconfig.load({'ZT_FIREBASE_CONFIG': json.dumps(GOOD), 'ZT_FIREBASE_EMULATOR': bad}))


if __name__ == '__main__':
    unittest.main()
