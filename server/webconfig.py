"""画面に実行のときに渡す設定（/api/config）。

Firebase の Web の設定は、組み立て（Cloud Build）ではなく Cloud Run の環境変数で渡す。
- ZT_FIREBASE_CONFIG: Firebase のコンソールの「SDK の設定と構成」の JSON（apiKey・authDomain・projectId・appId など）
- ZT_FIREBASE_EMULATOR: 手元の試しだけ。Emulator Suite の住所の JSON（例: {"auth": "http://127.0.0.1:9099", "firestore": "127.0.0.1:8180"}）
どちらも無い・読めないときは firebase を null にし、画面はログインの部品を出さない。
Web の設定の apiKey は秘密ではない（ブラウザに配る種類）が、決まった項目だけを、決まった形のときだけ渡す。
"""
import json
import re

KEYS = ('apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId', 'storageBucket')
NEED = ('apiKey', 'authDomain', 'projectId', 'appId')
VALUE = re.compile(r'^[A-Za-z0-9:._\-]{1,200}$')
FIRESTORE_HOST = re.compile(r'^[A-Za-z0-9.\-]{1,100}:\d{2,5}$')
AUTH_URL = re.compile(r'^https?://[A-Za-z0-9.\-]{1,100}:\d{2,5}$')


def _obj(raw):
    try:
        v = json.loads(raw or '')
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, dict) else None


def firebase(raw):
    """ZT_FIREBASE_CONFIG の文字列から、画面に渡す Firebase の設定（使えないときは None）"""
    v = _obj(raw)
    if not v:
        return None
    out = {k: v[k] for k in KEYS if isinstance(v.get(k), str) and VALUE.match(v[k])}
    return out if all(k in out for k in NEED) else None


def emulator(raw):
    """ZT_FIREBASE_EMULATOR の文字列から、Emulator の住所（使えないときは None）"""
    v = _obj(raw)
    if not v:
        return None
    auth, store = v.get('auth'), v.get('firestore')
    if not (isinstance(auth, str) and AUTH_URL.match(auth) and isinstance(store, str) and FIRESTORE_HOST.match(store)):
        return None
    return {'auth': auth, 'firestore': store}


def load(env):
    """環境変数から /api/config の中身を作る"""
    fb = firebase(env.get('ZT_FIREBASE_CONFIG'))
    emu = emulator(env.get('ZT_FIREBASE_EMULATOR')) if fb else None
    return {'firebase': fb, 'emulator': emu} if emu else {'firebase': fb}
