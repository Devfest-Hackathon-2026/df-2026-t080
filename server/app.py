#!/usr/bin/env python3
# IntenTrip の試作サーバー（標準ライブラリだけ）。
#   GET  /                 画面（../web/dist）
#   POST /api/jobs         {start, end, area, wish} → 候補を集める仕事を始める（start・end は {text, name, ja?, lat, lng}。
#                          end が無ければ出発地に戻る。area は作り置きのエリアのボタンから入れたときのエリアの名前。
#                          前の形の {area, wish} だけでも受け、Gemini にエリアの中心と出発地を決めさせる。
#                          出発地と到着地が離れすぎていたら 400 {error: 'far'}）
#   GET  /api/geocode      ?q=<駅・ホテル・地名>&lang= → 地図のデータ（Nominatim・日本の中）で引いた {name, ja?, pref, city, lat, lng}
#                          （見つからなければ 404・問い合わせられなければ 503。同じ文字は作り置きから）
#   GET  /api/jobs/<id>    仕事の進み具合（steps）と結果。?after=<tag> を付けると、進むまで最大 20 秒待ってから返す
#   GET  /api/sample       最初に見せる例（sample.json。ほかの人が作ったプランは見せない）
#   GET  /api/areas        候補を取ってあるエリア（すぐに作れる）と、その出発地（{areas: [名前], starts: {名前: {name, ja?, lat, lng}}}）
#   POST /api/adjust       プランへの頼み → 画面ができる操作（{reply, ops}）
#   POST /api/odai         場所に合わせた旅のお題を 1 つ（{text}）
#   POST /api/penguin      {lang, facts} → プランに合わせた、その日に役立つ注意を 3〜5 行（{lines}。同じ資料の答えは作り置きから返す）
#   GET  /api/place/<id>   Places の名前・位置・評価・営業時間・写真 3 枚（取っておかずにそのまま返す。Places を使えないときは 503）
#   GET  /api/place-photo  ?name=<写真の名前>&w=<幅> → Places の写真へ飛ばす（302）
#   POST /api/area-search  {q, box: [南, 西, 北, 東], lang} → 地図に写っている範囲の中を Places で探す（取っておかずにそのまま返す。
#                          枠は照合と別。使えない・枠に届いたときは 503、範囲が広すぎるときは 400 の wide）
#   POST /api/place-find   {place, area} → まだ照合していない候補を 1 か所だけ照合して {placeId}（無ければ null。使えないときは 503）
#   GET  /api/bus          ?from=緯度,経度&to=緯度,経度&date=YYYY-MM-DD&after=HH:MM → 乗換なしのバス・電車の便を 3 つまで（bus.py）
#   GET  /api/bus-info     ?date=YYYY-MM-DD&box=南,西,北,東 → エリアで便を出せるか・時刻表の版と出典・出典の問い合わせ先・
#                          電車の目安を出せるか（rail・railLoading）
#                          （エリアに関わる時刻表・OSM の路線をまだ取っていなければ取る。どれを使うかは bus_feeds.py・rail.py）
#   POST /api/bus-table    {points, date, start, end, lang} → 点どうしの、乗換なしのバス・電車で戸口から戸口までの目安（分。便が無い組みは null）。
#                          時刻表の無い組みは、OSM の路線から求めた乗換なしの電車の目安で埋め、rail に {opts, via} を付ける（rail.py）
#   POST /api/matrix       {points: [[経度, 緯度]]} → 点どうしの移動の表（{matrix}。walk・drive は分、walkM は歩く道のりの m）
#   POST /api/slope        {legs: [{a, b}]} → 2 点を歩く道の上り下り（elev.py。{up, down, steepUp, steepDown, m}・データが無ければ {}・
#                          取れなかったら null）
# Gemini は gemini.py（Vertex AI）。ZT_LLM_MODULE に、同じ ask(prompt, model)・quota() を持つ別の Python ファイルを指定すると
# そちらで呼ぶ（手元での試験用）。
# 頼みは places.py の 4 つ（famous・hidden・food・wish）を同時に投げる。エリアの分は希望によらず cache/ に取っておく。
# 画面の言語（lang。'ja' か 'en'）を受け口で受け取り、英語なら Gemini に英語で書かせる。作り置きの鍵には英語のときだけ言語を入れる
# （日本語の作り置きは今までの鍵のまま使える）。例のプランは sample.json と sample.en.json。
# ★試作用。本番は Cloud Run ＋ Vertex AI の Gemini ＋ Places API に置き換える。
import gzip, hashlib, importlib.util, ipaddress, json, math, os, threading, time, traceback, unicodedata, uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import adjust, bus, elev, enrich, gplaces, odai, penguin, places, rail, transit, webconfig


def load_llm():
    path = os.environ.get('ZT_LLM_MODULE')
    if not path:
        import gemini
        return gemini
    spec = importlib.util.spec_from_file_location('zt_llm', os.path.expanduser(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Limited:
    """Gemini を呼ぶ回数に 1 時間あたりと 1 日（24 時間）あたりの上限を設ける（公開の URL で、チームの予算を使い切られないように）。
    上限に届いたら、枠が足りないときと同じ扱いにする。ZT_LLM_PER_HOUR=0・ZT_LLM_PER_DAY=0 でそれぞれ上限なし。
    呼ぶ係が before_send を持つとき（gemini.py）は、そこで送るたびに数える（中でやり直す分も数える）。
    持たない係は、ask・ask_image を呼ぶたびに 1 回と数える。
    数はこのプロセスのメモリの中だけにあるので、置き直すと 0 から数え直し、入れ物が 2 つあればそれぞれで数える
    （Cloud Run の最大インスタンス数を 1 にして使う）"""

    def __init__(self, mod, per_hour, per_day=0):
        self.mod, self.per_hour, self.per_day = mod, per_hour, per_day
        self.times, self.day, self.lock = [], [], threading.Lock()
        self.inside = hasattr(mod, 'before_send')
        if self.inside:
            mod.before_send = self._take

    def _take(self):
        if self.per_hour <= 0 and self.per_day <= 0:
            return
        now = time.time()
        with self.lock:
            self.times = [t for t in self.times if now - t < 3600]
            self.day = [t for t in self.day if now - t < 86400]
            if self.per_hour > 0 and len(self.times) >= self.per_hour:
                raise RuntimeError('枠: 1 時間あたりの Gemini の呼び出しの上限に届きました')
            if self.per_day > 0 and len(self.day) >= self.per_day:
                raise RuntimeError('枠: 1 日あたりの Gemini の呼び出しの上限に届きました')
            if self.per_hour > 0:
                self.times.append(now)
            if self.per_day > 0:
                self.day.append(now)

    def room(self, now=None):
        """1 時間と 1 日の上限までに、あと何回呼べるか（上限なしは無限）"""
        now = time.time() if now is None else now
        with self.lock:
            left = [self.per_hour - sum(1 for t in self.times if now - t < 3600)] if self.per_hour > 0 else []
            left += [self.per_day - sum(1 for t in self.day if now - t < 86400)] if self.per_day > 0 else []
        return max(0, min(left)) if left else math.inf

    def __getattr__(self, name):
        attr = getattr(self.mod, name)
        if name not in ('ask', 'ask_image'):
            return attr

        def call(*args, **kwargs):
            if not self.inside:
                self._take()
            return attr(*args, **kwargs)
        return call


llm = Limited(load_llm(), int(os.environ.get('ZT_LLM_PER_HOUR', '300')), int(os.environ.get('ZT_LLM_PER_DAY', '600')))

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, '..', 'web', 'dist')
CACHE = os.path.join(HERE, 'cache')
PORT = int(os.environ.get('ZT_PORT') or os.environ.get('PORT') or '8124')   # Cloud Run は PORT で渡す
MODEL = os.environ.get('ZT_MODEL', '')
QUOTA_MIN = float(os.environ.get('ZT_QUOTA_MIN', '0.25'))
LONG_POLL = 20                         # 様子を見に来たとき、進むまで待たせる長さ（秒）
os.makedirs(CACHE, exist_ok=True)

JOBS = {}
JOBS_LOCK = threading.Lock()
JOB_KEEP = 30 * 60                     # 終わった仕事を残しておく長さ（秒）
JOB_MAX = 200                          # 終わった仕事を残しておく数
LLM_SEM = threading.Semaphore(6)       # Gemini は同時に 6 つまで
LATER_SEM = threading.Semaphore(3)     # 2 段目の頼み（places.AFTER）は LLM_SEM と別に、同時に 3 つまで
LATER_SLOW = 60                        # 2 段目の頼みは、この秒数より長くかかって失敗したら（時間切れを含む）やり直さない
SHOT_SEM = threading.Semaphore(2)      # 乗換のスクショ（本体は 9MB まで）を同時に読むのは 2 つまで
SHOT_READ = 60                         # 乗換のスクショの本体を読み終える締め切り（秒）
GEO_LOCK = threading.Lock()
GEO_PATH = os.path.join(CACHE, 'geo.json')
try:
    GEO = json.load(open(GEO_PATH, encoding='utf-8'))
except (OSError, ValueError):
    GEO = {}
PHOTO_PATH = os.path.join(CACHE, 'photo.json')
LEGS_PATH = os.path.join(CACHE, 'legs.json')
try:
    PHOTO = json.load(open(PHOTO_PATH, encoding='utf-8'))
except (OSError, ValueError):
    PHOTO = {}
try:
    LEGS = json.load(open(LEGS_PATH, encoding='utf-8'))
except (OSError, ValueError):
    LEGS = {}
SLOPE_PATH = os.path.join(CACHE, 'slope.json')
try:
    SLOPE = json.load(open(SLOPE_PATH, encoding='utf-8'))
except (OSError, ValueError):
    SLOPE = {}
SAVE_LOCK = threading.Lock()
_quota = {'at': 0.0, 'v': None}
BUS = bus.Store(os.path.join(CACHE, 'bus'))
RAIL = rail.Store(os.path.join(CACHE, 'rail'))
# 相手ごとの Gemini の 1 時間あたりの上限（既定は頼みの数 × 4）
LLM_RATE = bus.Rate(int(os.environ.get('ZT_LLM_PER_CLIENT', str(4 * len(places.AREA_TASKS)))), 0)
def places_per_client():
    """相手ごとの Places の 1 時間あたりの上限。ZT_PLACES_PER_CLIENT が無ければ、全体の 1 時間の上限の半分（最低 10。全体が上限なしなら 120）"""
    v = os.environ.get('ZT_PLACES_PER_CLIENT', '').strip()
    if v:
        return int(v)
    return max(10, gplaces.PER_HOUR // 2) if gplaces.PER_HOUR > 0 else 120


PLACES_RATE = bus.Rate(places_per_client(), 0)


def side_all_per_hour(name):
    """エリアづくり以外の Gemini の頼み（ペンギンの一言・お題）の、全体の 1 時間あたりの上限。
    環境変数 name が無ければ、Gemini の 1 時間の上限の 4 分の 1（最低 10。Gemini が上限なしなら 120）"""
    v = os.environ.get(name, '').strip()
    if v:
        return int(v)
    return max(10, llm.per_hour // 4) if llm.per_hour > 0 else 120


# ペンギンの一言の 1 人あたりと全体の 1 時間の上限（エリアづくりの LLM_RATE とは別に数える。Gemini の Limited には今までどおり数える）
NOTE_RATE = bus.Rate(int(os.environ.get('ZT_NOTE_PER_CLIENT', '12')), side_all_per_hour('ZT_NOTE_ALL_PER_HOUR'))
# お題の 1 人あたりと全体の 1 時間の上限（ペンギンの一言と同じく、エリアづくりの LLM_RATE とは別に数える。1 回押すと場所の数だけ呼ぶ）
ODAI_RATE = bus.Rate(int(os.environ.get('ZT_ODAI_PER_CLIENT', '9')), side_all_per_hour('ZT_ODAI_ALL_PER_HOUR'))
NOTES = {}                             # ペンギンの一言の作り置き（資料と言葉の鍵 → (作った時刻, lines)）
NOTES_LOCK = threading.Lock()
NOTE_KEEP = 24 * 3600                  # 作り置きを使う長さ（秒）
NOTE_MAX = 500                         # 作り置きの数（超えたら古く作った物から外す）
# 「この付近で検索」の 1 人あたりと全体の 1 時間の上限（1 日の上限は gplaces.AREA_PER_DAY）
AREA_RATE = bus.Rate(int(os.environ.get('ZT_AREA_SEARCH_PER_CLIENT', '10')), int(os.environ.get('ZT_AREA_SEARCH_ALL_PER_HOUR', '60')))
AREA_MAX_SIDE = 0.3                    # 探す範囲の一辺の上限（度。30 km ほど。広すぎる範囲は地図を拡大してもらう）
MATRIX_MAX = 80                                  # 表を作り直すときの点の数の上限
MATRIX_COST = 8                                  # 表を 1 つ作るのを、線の何本分と数えるか
LEGS_RATE = bus.Rate(int(os.environ.get('ZT_LEGS_PER_CLIENT', '240')), int(os.environ.get('ZT_LEGS_ALL_PER_HOUR', '1800')))
SLOPE_RATE = bus.Rate(int(os.environ.get('ZT_SLOPE_PER_CLIENT', '240')), int(os.environ.get('ZT_SLOPE_ALL_PER_HOUR', '900')))
GEOCODE_RATE = bus.Rate(int(os.environ.get('ZT_GEOCODE_PER_CLIENT', '60')), int(os.environ.get('ZT_GEOCODE_ALL_PER_HOUR', '600')))
BUS_RATE = bus.Rate(int(os.environ.get('ZT_BUS_PER_HOUR', '240')), int(os.environ.get('ZT_BUS_ALL_PER_HOUR', '3000')))
CONTACT = os.environ.get('ZT_CONTACT', '').strip()[:120]
# 画面に実行のときに渡す設定（Firebase の Web の設定など。無ければログインの部品を出さない）
WEB_CONFIG = webconfig.load(os.environ)
BUS_TABLES = {}                        # 目安の表の作り置き（点・日・時間帯・時刻表の版・電車のデータの版・言語ごと）


def norm(s):
    return unicodedata.normalize('NFKC', s).strip()


def finite(s):
    v = float(s)
    if not math.isfinite(v):
        raise ValueError('not finite')
    return v


def no_constant(s):
    raise ValueError(s)


def parse_body(raw):
    """POST の本体（JSON の dict）。NaN・Infinity・桁あふれの数・dict でない物は ValueError"""
    body = json.loads(raw or b'{}', parse_float=finite, parse_constant=no_constant)
    if not isinstance(body, dict):
        raise ValueError('not an object')
    return body


def leg_point(v):
    """区間の端の [経度, 緯度]。数の 2 つ組で、日本のまわり（bus.parse_point と同じ範囲）だけ。ほかは None"""
    if not isinstance(v, list) or len(v) != 2 or not all(isinstance(x, (int, float)) for x in v):
        return None
    ll = bus.parse_point(f'{v[1]},{v[0]}')
    return [ll[1], ll[0]] if ll else None


def slope_key(a, b):
    return 'v1:' + hashlib.sha1(f'{a[0]:.5f},{a[1]:.5f}>{b[0]:.5f},{b[1]:.5f}'.encode()).hexdigest()[:16]


def client_key(ip):
    """相手の印。IPv6 は /64 にまとめる（1 つの回線に 2^64 個の住所が配られるので）。IPv4 はそのまま"""
    try:
        a = ipaddress.ip_address(ip.strip().strip('[]').split('%', 1)[0])
    except ValueError:
        return ip
    if a.version == 6:
        if a.ipv4_mapped:
            return str(a.ipv4_mapped)
        return str(ipaddress.ip_network(f'{a}/64', strict=False))
    return str(a)


def proxy_hops(env):
    """X-Forwarded-For を書き足す前の段の数。ZT_PROXY_HOPS が無ければ、Cloud Run（K_SERVICE がある）では 1、
    ほか（手元で直に開くとき）は 0（X-Forwarded-For は相手が自由に書けるので見ない）"""
    v = env.get('ZT_PROXY_HOPS', '').strip()
    if v:
        return max(0, int(v))
    return 1 if env.get('K_SERVICE') else 0


PROXY_HOPS = proxy_hops(os.environ)


def lang_of(v):
    return 'en' if v == 'en' else 'ja'


def lang_tail(lang):
    """作り置きの鍵に足す分（英語だけ。日本語は足さない）"""
    return ('en',) if lang == 'en' else ()


def key_of(*parts):
    return hashlib.sha1('\n'.join(norm(p) for p in parts).encode()).hexdigest()[:16]


def path_of(kind, k):
    return os.path.join(CACHE, f'{kind}-{k}.json')


def load(path):
    try:
        return json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return None


def job_tag(job):
    """仕事の今の様子の印。版・状態・進んだ数・各段の状態のどれかが変われば変わる"""
    steps = ','.join(f"{st.get('key')}:{st.get('state')}" for st in list(job.get('steps') or []))
    raw = f"{job.get('version', 0)}|{job.get('state')}|{job.get('done', 0)}|{steps}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def snap(obj):
    """書き出す前に写しをとる。別の頼みが同じ表に足している最中に書き出すと、途中で落ちるため
    （dict() と list() の写しは、書き換えの合間に割り込まれない）"""
    if isinstance(obj, dict):
        return {k: snap(v) for k, v in dict(obj).items()}
    if isinstance(obj, list):
        return [snap(v) for v in list(obj)]
    return obj


def save_json(path, obj):
    obj = snap(obj)
    tmp = f'{path}.{threading.get_ident()}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def quota_ok():
    if time.time() - _quota['at'] > 600:
        _quota['v'], _quota['at'] = llm.quota(), time.time()
    q = _quota['v']
    if not q:
        return True
    vals = [v for v in q.values() if isinstance(v, float)]
    return not vals or min(vals) >= QUOTA_MIN


def note_get(k, now=None):
    now = time.time() if now is None else now
    with NOTES_LOCK:
        hit = NOTES.get(k)
        if hit and now - hit[0] < NOTE_KEEP:
            return hit[1]
        NOTES.pop(k, None)
    return None


def note_put(k, lines, now=None):
    now = time.time() if now is None else now
    with NOTES_LOCK:
        NOTES.pop(k, None)
        NOTES[k] = (now, lines)
        while len(NOTES) > NOTE_MAX:
            NOTES.pop(next(iter(NOTES)))


def ask_task(task, area, wish, lang='ja', ctx=None):
    last = None
    for _ in range(2):                  # 1 回だけやり直す
        t0 = time.time()
        try:
            with LATER_SEM if task in places.AFTER else LLM_SEM:
                text = llm.ask(places.build_prompt(task, area, wish, lang, ctx), MODEL)
            r = places.parse_json(text)
            return places.label_themes(r, task, ctx, lang) if task in places.AFTER else r
        except Exception as e:  # noqa: BLE001
            last = e
            if '枠' in str(e) or (task in places.AFTER and time.time() - t0 >= LATER_SLOW):
                break
    raise last


def set_step(job, k, state):
    for s in job['steps']:
        if s['key'] == k:
            s['state'] = state


def build_result(area_data, wish_data, area_text, wish, matrix=None, trip=None):
    # 写真・位置の係が場所の情報を書き換えている最中に、進み具合の返事で書き出しても落ちないように写しで返す。
    # 到着地（end）は、出発地に戻らない旅だけ。query の start・end は画面が送った出発地と到着地（同じ候補で探し直すときに送り返す）
    ids = {p['id'] for p in wish_data['places']}
    return snap({
        'matrix': matrix,
        'area': places.reach_area(area_data['area'], wish_data['places']), 'start': area_data['start'], **({'end': area_data['end']} if area_data.get('end') else {}),
        'districts': area_data.get('districts') or [],
        **({'themes': area_data['themes']} if area_data.get('themes') else {}),
        'conditions': wish_data['conditions'],
        'places': wish_data['places'] + [p for p in area_data['places'] if p['id'] not in ids],
        'query': {'area': area_text, 'wish': wish, **({'start': trip['start'], 'end': trip['end']} if trip else {})},
        'createdAt': int(time.time()),
    })


def publish(job, result, state):
    job['result'] = result
    job['version'] = job.get('version', 0) + 1
    job['state'] = state


def add_photos(plist, area):
    """写真を探す。英語の候補は日本語の名前で探す（Wikipedia は日本語版なので）"""
    if not any(p.get('ja') for p in plist):
        enrich.add_photos(plist, PHOTO, places.area_hint(area))
        return
    views = [{**p, 'name': places.jname(p)} for p in plist]
    enrich.add_photos(views, PHOTO, places.area_hint(area))
    for p, v in zip(plist, views):
        if 'photo' in v:
            p['photo'] = v['photo']


SAMPLE_M = 1000                        # 例のプランの候補を使う、出発地からの距離（m）


def sample_of(lang):
    return load(os.path.join(HERE, 'sample.en.json' if lang == 'en' else 'sample.json'))


def sample_trip(trip, lang):
    """出発地に戻る旅で、出発地が例のプラン（sample.json）の出発地から SAMPLE_M 以内なら、例のプラン。ほかは None"""
    if not trip or trip.get('end'):
        return None
    d = sample_of(lang) or {}
    st, area, q = d.get('start'), d.get('area'), d.get('query')
    if not (isinstance(st, dict) and isinstance(area, dict) and isinstance(q, dict) and q.get('area') and d.get('places')):
        return None
    here = (places.num(st.get('lat')), places.num(st.get('lng')))
    return d if places.dist_m(here, (trip['start']['lat'], trip['start']['lng'])) <= SAMPLE_M else None


def same_wish(a, b):
    """希望の文が同じか（NFKC・空白・大文字小文字・終わりの句点を除いて）"""
    return compact(a).lower().rstrip('。.') == compact(b).lower().rstrip('。.')


def sample_area(d):
    """例のプランから、エリアの作り置きの形を作る（写し）。移動の表も作り置きに置き、OSRM に問い合わせないようにする"""
    plist = [{**p, **({} if p.get('placeId') else {'placeMiss': True})} for p in json.loads(json.dumps(d['places']))]
    ad = {'area': dict(d['area']), 'start': dict(d['start']), 'districts': list(d.get('districts') or []), 'places': plist}
    m = d.get('matrix') if isinstance(d.get('matrix'), dict) else {}
    if m.get('ids') == ['start'] + [p['id'] for p in plist] and m.get('walk'):
        k = table_key([ad['start'], *plist])
        with SAVE_LOCK:
            if not os.path.exists(path_of('matrix', k)):
                save_json(path_of('matrix', k), {**{x: m[x] for x in ('walk', 'drive') if x in m}, 'fixed': True})
            if m.get('heights') and not os.path.exists(path_of('heights', k)):
                save_json(path_of('heights', k), m['heights'])
    return ad


def job_plan(area_text, wish, lang='ja', trip=None):
    """作り置きを読み、Gemini に頼む分を決める → (エリアの鍵, 希望の鍵, エリアの作り置き, 希望の作り置き, 頼む分)。
    旅（出発地と到着地）の頼みは、エリアの名前と 2 点の位置で鍵を作る。出発地に戻る旅で、その名前のエリアの作り置き
    （出発地と到着地を入れる前の形）があり、作り置きの出発地が引いた出発地から 1 km 以内なら、それを使う"""
    sample = sample_trip(trip, lang)
    if sample:
        name = sample['query']['area']
        akey, wkey = key_of('area', name, *lang_tail(lang)), key_of('wish', name, wish, *lang_tail(lang))
        if not wish:
            wish_data = {'conditions': [], 'places': []}
        elif same_wish(wish, str(sample['query'].get('wish') or '')):
            wish_data = {'conditions': json.loads(json.dumps(sample.get('conditions') or [])), 'places': []}
        else:
            wish_data = load(path_of('wish', wkey))
        return akey, wkey, sample_area(sample), wish_data, [] if wish_data is not None else ['wish']
    akey, wkey = key_of('area', area_text, *lang_tail(lang)), key_of('wish', area_text, wish, *lang_tail(lang))
    if trip:
        tkey = key_of(*places.trip_key(trip), *lang_tail(lang))
        area_data = load(path_of('area', tkey))
        old = None if area_data or trip['end'] else load(path_of('area', akey))
        was = (old or {}).get('start') if isinstance((old or {}).get('start'), dict) else {}
        if old and was and not old.get('end') and places.dist_m(
                (places.num(was.get('lat')), places.num(was.get('lng'))), (trip['start']['lat'], trip['start']['lng'])) <= 1000:
            area_data = old
        else:
            akey, wkey = tkey, key_of('wish', *places.trip_key(trip), wish, *lang_tail(lang))
    else:
        area_data = load(path_of('area', akey))
    wish_data = load(path_of('wish', wkey)) if wish else {'conditions': [], 'places': []}
    tasks = ([] if area_data else list(places.AREA_TASKS)) + ([] if wish_data is not None else ['wish'])
    return akey, wkey, area_data, wish_data, tasks


def prefetch_rail(ad):
    """最初のプランを出すときに、時刻表の無いエリアなら、電車の路線を取り始める（別のスレッドで。待たない）。
    候補を 2 km ほど広げた範囲で取り、あとから届く候補も同じ作り置きで足りるようにする"""
    pts = [(p['lat'], p['lng']) for p in [ad.get('start') or {}, *ad.get('places', [])] if isinstance(p.get('lat'), (int, float))]
    if not pts or not RAIL.enabled():
        return

    def go():
        try:
            if BUS.feeds_for(bus.area_box(pts)):
                return
            s, w = min(p[0] for p in pts) - 0.02, min(p[1] for p in pts) - 0.02
            n, e = max(p[0] for p in pts) + 0.02, max(p[1] for p in pts) + 0.02
            RAIL.get([(s, w), (n, e)])
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    threading.Thread(target=go, daemon=True).start()


def table_key(pts):
    return hashlib.sha1(';'.join(f"{p['lat']:.4f},{p['lng']:.4f}" for p in pts).encode()).hexdigest()[:16]


def table_ready(pts):
    m = load(path_of('matrix', table_key(pts)))
    return bool(m and 'walkM' in m)


def table_of(pts):
    """pts: [{lat, lng}] → 点どうしの移動の表（enrich.matrix に、あれば地点の高さ heights を足した物）。取れなければ None"""
    k = table_key(pts)
    m = load(path_of('matrix', k))
    if not m or ('walkM' not in m and not m.get('fixed')):
        fresh = enrich.matrix(pts)
        if fresh:
            m = fresh
            save_json(path_of('matrix', k), m)
    if not m:
        return None
    h = load(path_of('heights', k))
    if not h:
        try:
            h = elev.heights(pts)
        except elev.Busy:
            h = None
        if h and any(x is not None for x in h):
            save_json(path_of('heights', k), h)
    return {**{x: v for x, v in m.items() if x != 'fixed'}, **({'heights': h} if h and len(h) == len(pts) else {})}


def run_job(job, area_text, wish, lang='ja', trip=None):
    """頼みを同時に投げ、人気スポット・飲食店・希望がそろったら先にプランを出す（state=ready）。
    残りの候補が届くたびに結果を差し替え、最後に位置を確かめて state=done。
    trip（出発地と到着地。places.trip_of）があるときは、頼みのエリアの所に旅の向きと 2 点の位置を書き足し、
    エリアの中心と範囲・出発地・到着地を 2 点から決める"""
    akey, wkey, area_data, wish_data, tasks = job_plan(area_text, wish, lang, trip)
    ask_area = places.trip_prompt_area(trip) if trip else area_text
    draft = bool(area_data and area_data.get('partial'))   # 2 段目の途中で取っておいたエリア（ほかの仕事が集めている途中）
    keys = list(dict.fromkeys(places.STEP.get(t, t) for t in tasks))
    job['steps'] = [{'key': k, 'state': 'wait'} for k in keys] + [{'key': 'verify', 'state': 'wait'}]
    raw, lock, changed = {}, threading.RLock(), threading.Event()
    limited = threading.Event()   # どれかの頼みが Gemini の 1 時間・1 日の上限で断られた
    tstate = {t: 'wait' for t in tasks}
    try:
        if tasks and not quota_ok():
            raise RuntimeError('quota')

        def mark(t, state):
            """頼み t の様子を、進み具合の段（いくつかの頼みをまとめた段もある）に写す"""
            with lock:
                tstate[t] = state
                k = places.STEP.get(t, t)
                sub = [s for u, s in tstate.items() if places.STEP.get(u, u) == k]
                later = [s for u, s in tstate.items() if places.STEP.get(u, u) == k and u in places.AFTER]
                if all(s == 'error' for s in sub) or (later and all(s == 'error' for s in later)):
                    agg = 'error'
                elif all(s in ('done', 'error') for s in sub):
                    agg = 'done'
                else:
                    agg = 'run' if any(s != 'wait' for s in sub) else 'wait'
                set_step(job, k, agg)

        def run(t, ctx=None):
            mark(t, 'run')
            t1 = time.time()
            try:
                r = ask_task(t, ask_area, wish, lang, ctx)
                with lock:
                    raw[t] = r
                mark(t, 'done')
                job['times'][t] = round(time.time() - t1)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                if '枠' in str(e):
                    limited.set()
                mark(t, 'error')
            # 2 段目: 待っていた頼みが全部終わったら（失敗も終わりに数える）、届いた答えを渡して投げる。
            # famous の答えが無いときは、投げずに失敗にする
            with lock:
                ended.add(t)
                nxt = [d for d, deps in places.AFTER.items() if d in tasks and d not in started and all(x in ended for x in deps if x in tasks)]
                if nxt:
                    started.update(nxt)
                    if 'famous' in tasks and 'famous' not in raw:
                        skipped.update(nxt)
                        for d in nxt:
                            mark(d, 'error')
                    else:
                        try:
                            ctx2 = places.after_ctx(dict(raw), lang)
                        except Exception:  # noqa: BLE001
                            traceback.print_exc()
                            ctx2 = None
                        for d in nxt:
                            try:
                                futs.append(ex.submit(run, d, ctx2))
                            except Exception:  # noqa: BLE001
                                traceback.print_exc()
                                skipped.add(d)
                                mark(d, 'error')
            changed.set()
        ex = ThreadPoolExecutor(8)
        futs, started, ended, skipped = [], set(), set(), set()
        with lock:
            first = [t for t in tasks if not any(x in tasks for x in places.AFTER.get(t, ()))]
            started.update(first)
            futs.extend(ex.submit(run, t) for t in first)

        anchor = {}

        def anchor_of():
            """エリアの名前を地図のデータで引いた位置（中心の確かめに使う。1 つの仕事で 1 回だけ引く）"""
            if 'v' not in anchor:
                with GEO_LOCK:
                    geo = dict(GEO)
                anchor['v'] = places.area_anchor(area_text, geo)
                with GEO_LOCK:
                    GEO.update(geo)
            return anchor['v']

        def assemble(wide=False):
            """届いた分で area_data と wish_data を作る（wide: エリアの範囲を 2 倍に広げて数える）"""
            with lock:
                got = dict(raw)
            ad = area_data
            if not ad:
                if 'famous' not in got:
                    return None, None
                ad = places.clean_area(got['famous'], area_text, lang)
                if wide and not trip:
                    ad['area']['radius'] = min(40.0, ad['area']['radius'] * 2)
                plist = [places.clean_place(p, 'hidden' if t.startswith('hidden') else 'food' if t == 'cafe' else t, lang)
                         for t in places.AREA_TASKS for p in places.items(places.obj(got.get(t)).get('places'))]
                if (places.place_trip(ad, [p for p in plist if p], trip, lang, wide) if trip
                        else places.recenter(ad, [p for p in plist if p], anchor_of())):
                    print(f'[job] {area_text!r}: エリアの中心を候補の位置から決め直した（{ad["area"]}）', flush=True)
                ad['places'] = [p for p in places.merge_places([p for p in plist if p]) if places.in_area(p, ad['area'])]
                themes = [t for t in places.clean_themes(got['themes'], lang)['themes'] if t['hint']] if got.get('themes') else []
                if themes:
                    ad['themes'] = themes
            wd = wish_data
            if wd is None:
                w = got.get('wish') or {}
                wd = {'conditions': places.clean_conditions(w, lang),
                      'places': places.keep_named([p for p in (places.clean_place(x, 'wish', lang) for x in places.items(w.get('places')))
                                                   if p and places.in_reach(p, ad['area'], (ad.get('start'), ad.get('end')))])}
            return ad, wd

        shown, drafted = 0, False
        while True:
            with lock:
                done_all = len(futs) + len(skipped) == len(tasks) and all(f.done() for f in futs)
                first_ready = all(tstate[t] in ('done', 'error') for t in places.FIRST_TASKS if t in tasks) or done_all
                first_all = all(tstate[t] in ('done', 'error') for t in tasks if t not in places.AFTER)
            with lock:
                have = set(raw)
            if first_ready and len(have) > shown:
                ad, wd = assemble()
                if ad and len(ad['places']) >= 5:
                    if not shown:
                        prefetch_rail(ad)
                    publish(job, build_result(ad, wd, area_text, wish, trip=trip), 'ready')
                    job['seconds'] = job.get('seconds') or round(time.time() - job['t0'])
                    shown = len(have)
            # 1 段目がそろい 2 段目を待つ間は、エリアを途中の印（partial）を付けて取っておく
            if not area_data and not drafted and first_all and not done_all and any(t in places.AFTER for t in tasks):
                ad, _ = assemble()
                if ad and len(ad['places']) >= 8:
                    with SAVE_LOCK:
                        save_json(path_of('area', akey), {**ad, 'partial': True, 'query': area_text, 'lang': lang, 'createdAt': int(time.time())})
                    drafted = True
            if done_all:
                break
            changed.wait(1.0)
            changed.clear()
        ex.shutdown(wait=False)

        ad, wd = assemble()
        if ad and len(ad['places']) < 8 and not area_data:
            # 候補がエリアの範囲の外に多かったときは、範囲を広げてもう一度数える。
            # 広げた範囲はそのまま取っておく（その範囲で集めた候補なので、希望の候補も同じ範囲で数える）
            ad2, wd2 = assemble(wide=True)
            if ad2 and len(ad2['places']) > len(ad['places']):
                ad, wd = ad2, wd2
        if not ad or len(ad['places']) < 8:
            with lock:
                got = dict(raw)
            counts = {t: len(places.items(places.obj(got.get(t)).get('places'))) for t in tasks}
            area = (ad or {}).get('area')
            print(f'[job] {area_text!r}: 候補が足りない（範囲の中 {len(ad["places"]) if ad else 0} 件・届いた数 {counts}・'
                  f'失敗 {[s["key"] for s in job["steps"] if s["state"] == "error"]}・エリア {area}）', flush=True)
            raise RuntimeError('quota' if tasks and (limited.is_set() or not quota_ok()) else 'failed')
        area_data, wish_data = ad, wd

        def all_places():
            ids = {p['id'] for p in wish_data['places']}
            return wish_data['places'] + [p for p in area_data['places'] if p['id'] not in ids]

        def mine():
            """この仕事で照合・確かめ・写真を付ける場所（集めている途中のエリアを読んだときは、希望の場所だけ）"""
            return list(wish_data['places']) if draft else all_places()

        # Places で place_id と位置を照合する（位置の確かめの前に。場所ごとに 1 回だけ）
        gplaces.expire(mine())
        found = gplaces.locate(mine(), places.reach_area(area_data['area'], wish_data['places']))
        # 照合で名所でない店（金券ショップ・コンビニ・事務所など）と分かった見どころは、候補から外す
        area_data['places'] = [p for p in area_data['places'] if not p.get('notSight')]
        wish_data['places'] = [p for p in wish_data['places'] if not p.get('notSight')]
        if found['search'] or found['renew'] or found['known'] or found['left']:
            print(f"[places] {area_text!r}: 照合 {found['search']} 件・見つかった {found['found']} 件・"
                  f"位置の取り直し {found['renew']} 件・覚えていた {found['known']} 件・次に回した {found['left']} 件", flush=True)

        # 2 段目が全部失敗したエリアは取っておかない（希望の作り置きは取っておく）
        with lock:
            lacking = [t for t in tasks if t in places.AFTER] and all(tstate[t] == 'error' for t in tasks if t in places.AFTER)

        def save_caches():
            with SAVE_LOCK:
                path = path_of('area', akey)
                if draft:
                    pass                 # ほかの仕事が集めている途中のエリアは書き換えない
                elif not lacking:
                    save_json(path, {**area_data, 'query': area_text, 'lang': lang, 'createdAt': int(time.time())})
                elif drafted and (load(path) or {}).get('partial'):
                    os.remove(path)
                if wish:
                    save_json(path_of('wish', wkey), wish_data)
        if tasks or found['search'] or found['renew'] or found['known']:
            save_caches()
        job['seconds'] = job.get('seconds') or round(time.time() - job['t0'])
        extras = {'matrix': None}
        pub = threading.Lock()

        def republish(final=False):
            # 写真・移動時間の係が、仕事の終わり（待つのは 90 秒まで）より遅れて届けたときも、終わった仕事を途中に戻さない
            with pub:
                done = final or job.get('state') == 'done'
                publish(job, build_result(area_data, wish_data, area_text, wish, extras['matrix'], trip), 'done' if done else 'ready')

        def compute_matrix():
            # 点の並びは出発地・到着地（あれば）・候補（画面の lib/geo.ts の tableIds と同じ）
            plist = all_places()
            ends = [area_data['start']] + ([area_data['end']] if area_data.get('end') else [])
            m = table_of(ends + plist)
            if m:
                extras['matrix'] = {'ids': ['start', 'end'][:len(ends)] + [p['id'] for p in plist], **m}

        def do_photos():
            add_photos(mine(), area_data['area'])
            with SAVE_LOCK:
                save_json(PHOTO_PATH, PHOTO)
            republish()

        def do_matrix():
            compute_matrix()
            republish()
        republish()
        th = [threading.Thread(target=do_photos, daemon=True), threading.Thread(target=do_matrix, daemon=True)]
        for t in th:
            t.start()

        # 位置の確かめは裏で（Nominatim は 1 秒に 1 件）
        order = {'famous': 0, 'wish': 1, 'hidden': 2, 'food': 3}
        todo = sorted([p for p in mine() if 'verified' not in p], key=lambda p: order.get(p.get('source'), 9))
        job['total'], job['done'] = len(todo), 0
        set_step(job, 'verify', 'run' if todo else 'done')
        moved = False
        reach = places.reach_area(area_data['area'], wish_data['places'])
        if todo:
            with GEO_LOCK:
                geo = dict(GEO)
            if not trip:                 # 旅の出発地は、画面が地図のデータで引いた位置のまま
                before = (area_data['start']['lat'], area_data['start']['lng'])
                places.verify_start(area_data['start'], area_data['area'], geo)
                moved = before != (area_data['start']['lat'], area_data['start']['lng'])
            for p in todo:
                before = (p['lat'], p['lng'])
                places.verify_one(p, reach if p.get('source') == 'wish' else area_data['area'], geo)
                moved = moved or before != (p['lat'], p['lng'])
                job['done'] += 1
            with GEO_LOCK:
                GEO.update(geo)
                save_json(GEO_PATH, GEO)
            set_step(job, 'verify', 'done')
        for t in th:
            t.join(90)
        if moved or not extras['matrix']:
            compute_matrix()             # 位置を直したら、移動時間の表も作り直す
        save_caches()
        republish(final=True)
        job['state'] = 'done'
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        job['state'] = 'error'
        job['error'] = 'quota' if 'quota' in str(e) or '枠' in str(e) else 'failed'
    finally:
        job['ended'] = time.time()


def prune_jobs(now=None):
    """終わってから JOB_KEEP 秒たった仕事と、終わった仕事が JOB_MAX を超えた分の古い物を消す（JOBS_LOCK の中で呼ぶ）"""
    now = time.time() if now is None else now
    ended = sorted((j.get('ended') or now, k) for k, j in JOBS.items() if j['state'] in ('done', 'error'))
    for i, (at, k) in enumerate(ended):
        if now - at > JOB_KEEP or len(ended) - i > JOB_MAX:
            JOBS.pop(k, None)


def compact(s):
    return ''.join(unicodedata.normalize('NFKC', str(s or '')).split())


def area_presets(lang, cache_dir=None):
    """候補を取ってあるエリアの名前 → 出発地（無ければ None）。その言語で作った、出発地に戻る旅の分だけ。古い順。同じ名前は新しい方。
    打った文字がエリアの正規の名前と同じ（NFKC・空白を除いて）物だけ（打った文字のまま。作り置きに当たるように）"""
    cache_dir = cache_dir or CACHE
    got = []
    for f in sorted(os.listdir(cache_dir)):
        if f.startswith('area-'):
            d = load(os.path.join(cache_dir, f)) or {}
            q, name = d.get('query'), (d.get('area') or {}).get('name') if isinstance(d.get('area'), dict) else None
            st = d.get('start') if isinstance(d.get('start'), dict) else None
            if isinstance(q, str) and q and compact(q) == compact(name) and lang_of(d.get('lang')) == lang and not d.get('end'):
                start = {'name': str(st.get('name') or ''), **({'ja': st['ja']} if st.get('ja') else {}),
                         'lat': places.num(st.get('lat')), 'lng': places.num(st.get('lng'))} if st and st.get('name') else None
                got.append((d.get('createdAt') or 0, q, start))
    out = {}
    for _, q, start in sorted(got, key=lambda x: x[0]):
        out.pop(q, None)
        out[q] = start
    return out


def with_sample(presets, lang):
    """エリアの選択肢に、例のプランのエリアと出発地を足す（同じ名前の作り置きより先に、例のプランの出発地を使う）"""
    d = sample_of(lang) or {}
    q, st = d.get('query'), d.get('start')
    name = q.get('area') if isinstance(q, dict) else None
    if not (isinstance(name, str) and name and isinstance(st, dict) and st.get('name')):
        return presets
    out = {k: v for k, v in presets.items() if k != name}
    out[name] = {'name': str(st['name']), **({'ja': st['ja']} if st.get('ja') else {}), 'lat': places.num(st.get('lat')), 'lng': places.num(st.get('lng'))}
    return out


def area_names(lang, cache_dir=None):
    return list(area_presets(lang, cache_dir))


def sweep_expired():
    """作り置きの候補のうち、Google の位置を取って 30 日を過ぎたものを照合の前の位置に戻す（起動のときと 12 時間ごと）"""
    while True:
        for f in sorted(os.listdir(CACHE)):
            if not (f.startswith(('area-', 'wish-')) and f.endswith('.json')):
                continue
            path = os.path.join(CACHE, f)
            try:
                with SAVE_LOCK:
                    d = load(path)
                    if isinstance(d, dict) and gplaces.expire(d.get('places') or []):
                        save_json(path, d)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
        time.sleep(12 * 3600)


ZIP_TYPES = {'.js', '.mjs', '.css', '.svg', '.html', '.json', '.webmanifest'}
ZIP_MIN = 1024                         # これより小さい返事は圧縮しない（バイト）
GZ = {}                                # 画面のファイルの圧縮の作り置き（パス・更新時刻・大きさごと）
GZ_LOCK = threading.Lock()


def gzipped(full, data):
    """画面のファイルを圧縮した物（作り置きがあればそれ）"""
    st = os.stat(full)
    k = (full, st.st_mtime_ns, st.st_size)
    with GZ_LOCK:
        hit = GZ.get(k)
    if hit is None:
        hit = gzip.compress(data, 9, mtime=0)
        with GZ_LOCK:
            for old in [kk for kk in GZ if kk[0] == full]:
                GZ.pop(old, None)
            GZ[k] = hit
    return hit


TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
         '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
         '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
         '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm'}


class H(BaseHTTPRequestHandler):
    server_version = 'intentrip'
    timeout = 30                         # 相手から届く・相手へ送るのを待つ長さ（秒。1 回の読み書きごと）

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Strict-Transport-Security', 'max-age=31536000')
        super().end_headers()

    def write_body(self, data):
        """少しずつ送る（待ち時間は 1 回の送りごとに数えるので、遅い回線でも大きい返事が切れない）。HEAD には送らない"""
        if self.command == 'HEAD':
            return
        for i in range(0, len(data), 262144):
            self.wfile.write(data[i:i + 262144])

    def wants_gzip(self):
        """Accept-Encoding に gzip があるか（q=0 は断り）"""
        for part in (self.headers.get('Accept-Encoding') or '').split(','):
            name, _, params = part.partition(';')
            if name.strip().lower() in ('gzip', 'x-gzip'):
                q = params.strip().lower()
                try:
                    return not q.startswith('q=') or float(q[2:]) > 0
                except ValueError:
                    return True
        return False

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        big = len(body) > ZIP_MIN
        zipped = big and self.wants_gzip()
        if zipped:
            body = gzip.compress(body, 6, mtime=0)
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if big:
            self.send_header('Vary', 'Accept-Encoding')
        if zipped:
            self.send_header('Content-Encoding', 'gzip')
        self.end_headers()
        self.write_body(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/jobs/'):
            job = JOBS.get(path.rsplit('/', 1)[-1])
            if not job:
                return self.send_json(404, {'error': 'notfound'})
            # 前の印と同じ間は待つ。待っている間はリクエストが開いているので、Cloud Run の通常の設定でも裏の仕事に CPU が回る
            after = parse_qs(urlparse(self.path).query).get('after', [''])[0]
            end = time.time() + LONG_POLL
            while after and job['state'] in ('running', 'ready') and job_tag(job) == after and time.time() < end:
                time.sleep(0.25)
            out = snap({k: job.get(k) for k in ('id', 'state', 'version', 'steps', 'done', 'total', 'result', 'error', 'seconds', 'times')})
            out['tag'] = job_tag(job)
            return self.send_json(200, out)
        lang = lang_of(parse_qs(urlparse(self.path).query).get('lang', [''])[0])
        if path == '/api/sample':
            d = load(os.path.join(HERE, 'sample.en.json' if lang == 'en' else 'sample.json'))
            return self.send_json(200, d) if d else self.send_json(404, {'error': 'none'})
        if path == '/api/areas':
            presets = with_sample(area_presets(lang), lang)
            return self.send_json(200, {'areas': list(presets), 'starts': {k: v for k, v in presets.items() if v}})
        if path == '/api/geocode':
            return self.geocode(parse_qs(urlparse(self.path).query), lang)
        if path.startswith('/api/place/'):
            return self.place(path[len('/api/place/'):], lang)
        if path == '/api/place-photo':
            return self.place_photo(parse_qs(urlparse(self.path).query))
        if path == '/api/bus':
            return self.bus(parse_qs(urlparse(self.path).query), lang)
        if path == '/api/bus-info':
            return self.bus_info(parse_qs(urlparse(self.path).query))
        if path == '/api/health':
            return self.send_json(200, {'ok': True})
        if path == '/api/config':
            return self.send_json(200, WEB_CONFIG)
        if path == '/api' or path.startswith('/api/'):
            return self.send_json(404, {'error': 'notfound'})
        self.static(path)

    def do_HEAD(self):
        """GET と同じ頭だけ。Places・時刻表・仕事の様子など、外に問い合わせたり待ったりする受け口は断る"""
        path = urlparse(self.path).path
        if path.startswith('/api/') and path not in ('/api/health', '/api/sample', '/api/areas'):
            return self.send_json(405, {'error': 'method'})
        return self.do_GET()

    def do_POST(self):
        route = urlparse(self.path).path
        if route not in ('/api/jobs', '/api/legs', '/api/matrix', '/api/slope', '/api/transit-shot', '/api/adjust', '/api/odai', '/api/penguin', '/api/bus-table', '/api/place-find', '/api/area-search'):
            return self.send_json(404, {'error': 'notfound'})
        size = (self.headers.get('Content-Length') or '0').strip()
        if not (size.isascii() and size.isdigit()):
            return self.send_json(400, {'error': 'bad'})
        n = int(size)
        if n > {'/api/transit-shot': 9 * 1024 * 1024, '/api/adjust': 96 * 1024, '/api/penguin': 32 * 1024}.get(route, 16384):
            return self.send_json(413, {'error': 'large'})
        if route == '/api/transit-shot':
            return self.transit_shot(n)
        try:
            body = parse_body(self.rfile.read(n) if n else b'')
        except ValueError:
            return self.send_json(400, {'error': 'bad'})
        except TimeoutError:
            self.close_connection = True
            return None
        handler = {'/api/jobs': self.jobs, '/api/legs': self.legs, '/api/matrix': self.matrix, '/api/slope': self.slope, '/api/place-find': self.place_find, '/api/area-search': self.area_search,
                   '/api/adjust': self.adjust, '/api/odai': self.odai, '/api/penguin': self.penguin_note, '/api/bus-table': self.bus_table}[route]
        try:
            return handler(body)
        except ValueError:
            return self.send_json(400, {'error': 'bad'})

    def jobs(self, body):
        area = norm(str(body.get('area') or ''))[:40]
        wish = norm(str(body.get('wish') or ''))[:200]
        lang = lang_of(body.get('lang'))
        trip = None
        if body.get('start') is not None:
            start = places.trip_point(body.get('start'))
            end = places.trip_point(body.get('end')) if body.get('end') is not None else None
            if not start or (body.get('end') is not None and not end):
                return self.send_json(400, {'error': 'bad'})
            trip = places.trip_of(start, end, area, lang)
            if trip['far']:
                return self.send_json(400, {'error': 'far', 'km': trip['km']})
            area = trip['area']
        if not area:
            return self.send_json(400, {'error': 'area'})
        k = key_of('job', *(places.trip_key(trip) if trip else (area,)), wish, *lang_tail(lang))
        with JOBS_LOCK:
            prune_jobs()
            for j in JOBS.values():      # 同じ頼みが走っていればそれを返す
                if j['key'] == k and j['state'] in ('running', 'ready'):
                    return self.send_json(200, snap({'id': j['id'], 'state': 'running', 'steps': j['steps']}))
            tasks = job_plan(area, wish, lang, trip)[4]
            if tasks and (llm.room() < len(tasks) or not LLM_RATE.take(self.client(), n=len(tasks))):
                return self.send_json(200, {'id': '', 'state': 'error', 'error': 'quota'})
            job_id = uuid.uuid4().hex[:12]
            JOBS[job_id] = job = {'id': job_id, 'key': k, 'state': 'running', 'steps': [], 'done': 0, 'total': 0,
                                  't0': time.time(), 'times': {}}
        t = threading.Thread(target=run_job, args=(job, area, wish, lang, trip), daemon=True)
        t.start()
        t.join(0.5)                      # 取ってある分だけならすぐ終わる
        self.send_json(200 if job['state'] != 'running' else 202, snap({k2: job.get(k2) for k2 in ('id', 'state', 'version', 'steps', 'result', 'error')}))

    def read_within(self, n, limit, keep=True):
        """本体の n バイトを、始めから limit 秒のうちに読む（keep=False なら読み捨てる）。
        間に合わない・切れたときは None（そのまま閉じる）"""
        end = time.monotonic() + limit
        parts = []
        try:
            while n > 0:
                left = end - time.monotonic()
                if left <= 0:
                    raise TimeoutError('body')
                self.connection.settimeout(min(self.timeout, left))
                got = self.rfile.read1(min(n, 65536))
                if not got:
                    raise ConnectionError('closed')
                if keep:
                    parts.append(got)
                n -= len(got)
        except OSError:
            self.close_connection = True
            return None
        finally:
            self.connection.settimeout(self.timeout)
        return b''.join(parts)

    def transit_shot(self, n):
        """乗換案内のスクリーンショットを読む。{image: data URL, from, to} → {route} か {error}。
        回数・同時に読む数は本体を読む前に確かめ（断る相手には読む枠を取らせない）、本体は SHOT_READ 秒のうちに読む"""
        if not hasattr(llm, 'ask_image'):
            self.read_within(n, SHOT_READ, keep=False)
            return self.send_json(501, {'error': 'unsupported'})
        if not quota_ok() or not LLM_RATE.take(self.client()):
            if self.read_within(n, SHOT_READ, keep=False) is None:
                return None
            return self.send_json(200, {'error': 'quota'})
        if not SHOT_SEM.acquire(blocking=False):
            if self.read_within(n, SHOT_READ, keep=False) is None:
                return None
            return self.send_json(200, {'error': 'quota'})
        try:
            data = self.read_within(n, SHOT_READ)
            if data is None:
                return None
            try:
                body = parse_body(data)
            except ValueError:
                return self.send_json(400, {'error': 'bad'})
            del data
            try:
                mime, raw = transit.decode(str(body.get('image') or ''))
            except ValueError as e:
                return self.send_json(400, {'error': str(e)})
            prompt = transit.build_prompt(str(body.get('from') or '')[:40], str(body.get('to') or '')[:40], lang_of(body.get('lang')))
            del body
            try:
                with LLM_SEM:
                    text = llm.ask_image(prompt, raw, mime, MODEL)
                route = transit.clean(places.parse_json(text))
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                return self.send_json(200, {'error': 'quota' if '枠' in str(e) else 'failed'})
        finally:
            SHOT_SEM.release()
        if not route:
            return self.send_json(200, {'error': 'notfound'})
        return self.send_json(200, {'route': route})

    def adjust(self, body):
        """プランへの頼みを操作に置き換える。{request, area, plan, places, ...} → {reply, ops} か {error}"""
        if not str(body.get('request') or '').strip():
            return self.send_json(400, {'error': 'empty'})
        if not quota_ok() or not LLM_RATE.take(self.client()):
            return self.send_json(200, {'error': 'quota'})
        try:
            with LLM_SEM:
                text = llm.ask(adjust.build_prompt(body), MODEL)
            out = adjust.clean(places.parse_json(text), body)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json(200, {'error': 'quota' if '枠' in str(e) else 'failed'})
        return self.send_json(200, out)

    def odai(self, body):
        """場所に合わせた旅のお題を 1 つ考える。{place, level, examples, ...} → {text} か {error}"""
        if not quota_ok() or not ODAI_RATE.take(self.client()):
            return self.send_json(200, {'error': 'quota'})
        try:
            with LLM_SEM:
                text = llm.ask(odai.build_prompt(body), MODEL)
            out = odai.clean(places.parse_json(text), lang_of(body.get('lang')), body)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json(200, {'error': 'quota' if '枠' in str(e) else 'failed'})
        return self.send_json(200, {'text': out} if out else {'error': 'failed'})

    def penguin_note(self, body):
        """ペンギンの一言。{lang, facts} → {lines} か {error}。同じ資料と言葉の答えは作り置きから返し、Gemini を呼ばず枠も使わない"""
        lang = lang_of(body.get('lang'))
        facts = penguin.clean(body.get('facts'))
        if not facts:
            return self.send_json(400, {'error': 'bad'})
        k = key_of('penguin', json.dumps(facts, ensure_ascii=False, sort_keys=True), *lang_tail(lang))
        lines = note_get(k)
        if lines:
            return self.send_json(200, {'lines': lines})
        if not quota_ok() or not NOTE_RATE.take(self.client()):
            return self.send_json(429, {'error': 'quota'})
        try:
            with LLM_SEM:
                text = llm.ask(penguin.prompt(facts, lang), MODEL)
            lines = penguin.parse(text, lang)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json(429, {'error': 'quota'}) if '枠' in str(e) else self.send_json(200, {'error': 'failed'})
        if not lines:
            return self.send_json(200, {'error': 'failed'})
        note_put(k, lines)
        return self.send_json(200, {'lines': lines})

    def geocode(self, q, lang):
        """出発地・到着地に書いた文字を地図のデータで引く（同じ文字は作り置きから。回数は相手ごとに数える）"""
        text = norm(str(q.get('q', [''])[0]))[:60]
        if not text:
            return self.send_json(400, {'error': 'bad'})
        key = places.find_key(lang, text)
        with GEO_LOCK:
            known = key in GEO
            hit = GEO.get(key)
        if not known:
            if not GEOCODE_RATE.take(self.client()):
                return self.send_json(503, {'error': 'busy'})
            got = {}
            try:
                hit = places.geocode(text, lang, got)
            except places.GeoBusy:
                return self.send_json(503, {'error': 'unavailable'})
            with GEO_LOCK:
                GEO.update(got)
                save_json(GEO_PATH, GEO)
        return self.send_json(200, hit) if hit else self.send_json(404, {'error': 'notfound'})

    def place(self, place_id, lang='ja'):
        if not gplaces.enabled():
            return self.send_json(503, {'error': 'off'})
        if not PLACES_RATE.take(self.client()):
            return self.send_json(503, {'error': 'unavailable'})
        try:
            d = gplaces.details(place_id, lang)
        except gplaces.Off:
            return self.send_json(503, {'error': 'unavailable'})
        return self.send_json(200, d) if d else self.send_json(404, {'error': 'notfound'})

    def place_find(self, body):
        """場所の画面を開いた候補に place_id が無いとき、その 1 か所だけを照合する"""
        if not gplaces.enabled():
            return self.send_json(503, {'error': 'off'})

        def point(d, is_area):
            if not isinstance(d, dict):
                return None
            name, ja = str(d.get('name') or '').strip()[:60], str(d.get('ja') or '').strip()[:60]
            try:
                lat, lng = float(d['lat']), float(d['lng'])
            except (KeyError, TypeError, ValueError):
                return None
            if not name or not (20 <= lat <= 46 and 122 <= lng <= 154):
                return None
            out = {'name': name, 'lat': lat, 'lng': lng, **({'ja': ja} if ja else {})}
            if is_area:
                out['radius'] = max(1.0, min(40.0, places.num(d.get('radius'), 10.0)))
            return out
        p, area = point(body.get('place'), False), point(body.get('area'), True)
        if not p or not area or not places.in_area(p, area):
            return self.send_json(400, {'error': 'bad'})
        if not PLACES_RATE.take(self.client()):
            return self.send_json(503, {'error': 'unavailable'})
        try:
            pid = gplaces.find(p, area)
        except gplaces.Off:
            return self.send_json(503, {'error': 'unavailable'})
        return self.send_json(200, {'placeId': pid})

    def area_search(self, body):
        """地図に写っている範囲の中で、店などを Places の Text Search で探す（この付近で検索）"""
        if not gplaces.enabled():
            return self.send_json(503, {'error': 'off'})
        q = ' '.join(str(body.get('q') or '').split())[:60]
        box = body.get('box')
        try:
            s, w, n, e = (float(v) for v in box)
        except (TypeError, ValueError):
            return self.send_json(400, {'error': 'bad'})
        if not q or not (20 <= s < n <= 46 and 122 <= w < e <= 154):
            return self.send_json(400, {'error': 'bad'})
        if n - s > AREA_MAX_SIDE or e - w > AREA_MAX_SIDE:
            return self.send_json(400, {'error': 'wide'})
        if not AREA_RATE.take(self.client()):
            return self.send_json(503, {'error': 'limit'})
        try:
            got = gplaces.area_search(q, (s, w, n, e), lang_of(body.get('lang')))
        except gplaces.Off as ex:
            return self.send_json(503, {'error': 'limit' if str(ex) == 'limit' else 'unavailable'})
        return self.send_json(200, {'places': got})

    def place_photo(self, q):
        """写真の URL を Places に聞き、そこへ飛ばす（トークンを画面に渡さない）"""
        if not gplaces.enabled():
            return self.send_json(503, {'error': 'off'})
        if not PLACES_RATE.take(self.client()):
            return self.send_json(503, {'error': 'unavailable'})
        try:
            width = int(q.get('w', ['960'])[0])
        except ValueError:
            width = 960
        try:
            uri = gplaces.photo_uri(q.get('name', [''])[0], width)
        except gplaces.Off:
            return self.send_json(503, {'error': 'unavailable'})
        if not uri:
            return self.send_json(404, {'error': 'notfound'})
        self.send_response(302)
        self.send_header('Location', uri)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def client(self):
        """問い合わせた人の印。PROXY_HOPS が 1 以上なら X-Forwarded-For の後ろから PROXY_HOPS 個目
        （前の段が書き足した、前の段の見た相手。行が分かれていてもつないで見る）。0 なら、つないできた相手の住所"""
        if PROXY_HOPS > 0:
            raw = ','.join(self.headers.get_all('X-Forwarded-For') or [])
            fwd = [x.strip() for x in raw.split(',') if x.strip()]
            if len(fwd) >= PROXY_HOPS:
                return client_key(fwd[-PROXY_HOPS])
        return client_key(self.client_address[0])

    def bus(self, q, lang='ja'):
        if not BUS.enabled():
            return self.send_json(200, {'trips': [], 'off': True})
        args = bus.parse_query(q)
        if not args:
            return self.send_json(400, {'error': 'bad'})
        if not BUS_RATE.take(self.client()):
            return self.send_json(429, {'error': 'limit'})
        a, b, ymd, after = args
        info = {}
        try:
            trips, used = bus.find(BUS, a, b, ymd, after, info=info)
            with ThreadPoolExecutor(3) as ex:
                trips = list(ex.map(lambda t: bus.road_line(t, enrich.road_through), trips))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json(200, {'trips': [], 'error': 'failed'})
        for t in trips:
            t.pop('_pattern', None)
            bus.with_parts(t, a, b)
            bus.in_lang(t, lang)
        try:
            return self.send_json(200, {'trips': trips, 'sources': used, 'loading': bool(info.get('pending'))})
        except (BrokenPipeError, ConnectionResetError):
            return None

    def rail_of(self, points=None, box=None):
        """範囲の電車の路線のまとまりと様子（rail.Store.get の返事。壊れたら無いとみなす）"""
        try:
            return RAIL.get_box(rail.key_box([box[:2], box[2:]])) if box else RAIL.get(points)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return None, 'none'

    def bus_info(self, q):
        """エリアで便を出せるか。エリアに関わる時刻表をまだ取っていなければ取り（最大 25 秒待つ）、使う版と出典を返す。
        電車の目安を出せるか（rail）と、その路線を取っている途中か（railLoading）も返す（路線は待たずに取り始める）"""
        bus_on = BUS.enabled()
        if not bus_on and not RAIL.enabled():
            return self.send_json(200, {'on': False})
        if not BUS_RATE.take(self.client()):
            return self.send_json(429, {'error': 'limit'})
        ymd = bus.ymd_of(q.get('date', [''])[0])
        box = bus.parse_box(q.get('box', [''])[0])
        if not box:
            return self.send_json(200, {'on': bus_on, 'sources': [], 'contact': CONTACT or None, 'rail': False, 'railLoading': False})
        idxs, pending = [], False
        if bus_on:
            try:
                idxs, pending = BUS.indexes(bus.area_box([box[:2], box[2:]]), ymd)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self.send_json(200, {'on': False, 'sources': [], 'error': 'failed', 'contact': CONTACT or None})
        net, state = (None, 'none') if idxs or pending else self.rail_of(box=box)
        has_rail = net is not None and net.has_lines(bus.area_box([box[:2], box[2:]]))
        try:
            return self.send_json(200, {'on': bool(idxs) or pending, 'sources': bus.sources_of(idxs), 'loading': pending,
                                        'contact': CONTACT or None, 'rail': has_rail, 'railLoading': state == 'pending'})
        except (BrokenPipeError, ConnectionResetError):
            return None

    def bus_table(self, body):
        """場所どうしの、乗換なしのバス・電車で戸口から戸口までの目安（分）。プランの組み立ての「電車・バス」の時間に使う。
        時刻表の値がある組みはそのまま使い、無い組みだけ OSM の路線から求めた電車の目安で埋める"""
        bus_on = BUS.enabled()
        if not bus_on and not RAIL.enabled():
            return self.send_json(200, {'off': True})
        raw = body.get('points') if isinstance(body.get('points'), list) else []
        pts = [bus.parse_point(f'{p[0]},{p[1]}') if isinstance(p, list) and len(p) == 2 else None for p in raw[:bus.TABLE_MAX]]
        try:
            start, end = int(body.get('start')), int(body.get('end'))
        except (TypeError, ValueError):
            return self.send_json(400, {'error': 'bad'})
        if len(pts) < 2 or not all(pts) or not 0 <= start < end <= 30 * 60:
            return self.send_json(400, {'error': 'bad'})
        if not BUS_RATE.take(self.client()):
            return self.send_json(429, {'error': 'limit'})
        lang = lang_of(body.get('lang'))
        ymd = bus.ymd_of(str(body.get('date') or ''))
        idxs, pending = [], False
        if bus_on:
            try:
                idxs, pending = BUS.indexes(bus.area_box(pts), ymd)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self.send_json(200, {'error': 'failed'})
        # 電車の目安は時刻表の無いエリアだけで使う（時刻表のあるエリアの組み立ては、作り置きの路線のあるなしで変えない）
        net, state = (None, 'none') if idxs or pending else self.rail_of(points=pts)
        if pending or state == 'pending':
            return self.send_json(200, {'loading': True})
        if net is not None and not net.lines:
            net = None
        if not idxs and net is None:
            return self.send_json(200, {'none': True})
        k = key_of('bus-table', json.dumps([[round(a, 5), round(b, 5)] for a, b in pts]), str(ymd), str(start), str(end),
                   *sorted(f"{i.meta.get('feed')}:{i.meta.get('res')}:{i.meta.get('fetched')}:{i.meta.get('region')}" for i in idxs),
                   'rail:' + (net.version() if net is not None else '-'), lang)
        hit = BUS_TABLES.get(k)
        if hit is None:
            used = []
            try:
                table = bus.door_table(BUS, pts, ymd, start, end, idxs=idxs, used=used) if idxs else None
                if net is not None:
                    table, rail_part = rail.merge(table, net.best(pts), net, lang)
                else:
                    rail_part = None
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self.send_json(200, {'error': 'failed'})
            if not idxs and rail_part is None:
                table = None
            if len(BUS_TABLES) > 64:
                BUS_TABLES.clear()
            hit = BUS_TABLES[k] = (table, bus.sources_of(used), rail_part)
        table, sources, rail_part = hit
        if table is None:
            return self.send_json(200, {'none': True})
        out = {'minutes': table, 'sources': sources}
        if rail_part is not None:
            out['rail'] = rail_part
        try:
            return self.send_json(200, out)
        except (BrokenPipeError, ConnectionResetError):
            return None

    def legs(self, body):
        """区間ごとの道に沿った線。{legs: [{a: [経度, 緯度], b: [経度, 緯度], mode}]} → {lines}（日本の外の区間は null）"""
        legs = body.get('legs') if body.get('legs') is not None else []
        if not isinstance(legs, list):
            return self.send_json(400, {'error': 'bad'})

        todo = []
        for l in legs[:24]:
            a, b = (leg_point(l.get('a')), leg_point(l.get('b'))) if isinstance(l, dict) else (None, None)
            todo.append((a, b, 'walk' if isinstance(l, dict) and l.get('mode') == 'walk' else 'transit') if a and b else None)
        new = {enrich.leg_key(*t) for t in todo if t} - set(LEGS)
        allowed = not new or LEGS_RATE.take(self.client(), n=len(new))

        def one(t):
            if not t or (not allowed and enrich.leg_key(*t) not in LEGS):
                return None
            return enrich.leg_line(*t, LEGS)
        had = len(LEGS)
        with ThreadPoolExecutor(2) as ex:
            out = list(ex.map(one, todo))
        if len(LEGS) != had:
            with SAVE_LOCK:
                save_json(LEGS_PATH, LEGS)
        try:
            return self.send_json(200, {'lines': out})
        except (BrokenPipeError, ConnectionResetError):
            return None                  # 画面を閉じた・次の頼みに切り替えた

    def matrix(self, body):
        """点どうしの移動の表を作り直す。{points: [[経度, 緯度]]} → {matrix}（walk・drive・walkM・あれば heights。取れなければ null）"""
        pts = body.get('points')
        if not isinstance(pts, list) or not 2 <= len(pts) <= MATRIX_MAX:
            return self.send_json(400, {'error': 'bad'})
        ll = [leg_point(v) for v in pts]
        if not all(ll):
            return self.send_json(400, {'error': 'bad'})
        plist = [{'lat': y, 'lng': x} for x, y in ll]
        if not table_ready(plist) and not LEGS_RATE.take(self.client(), n=MATRIX_COST):
            return self.send_json(429, {'error': 'busy'})
        m = table_of(plist)
        try:
            return self.send_json(200, {'matrix': m})
        except (BrokenPipeError, ConnectionResetError):
            return None

    def slope(self, body):
        """歩く区間の上り下り。{legs: [{a: [経度, 緯度], b: [経度, 緯度]}]} → {slopes}（日本の外・読めない区間は {}＝データなし）"""
        legs = body.get('legs') if body.get('legs') is not None else []
        if not isinstance(legs, list):
            return self.send_json(400, {'error': 'bad'})

        todo = []
        for l in legs[:24]:
            a, b = (leg_point(l.get('a')), leg_point(l.get('b'))) if isinstance(l, dict) else (None, None)
            todo.append((a, b) if a and b else None)
        new = {slope_key(*t) for t in todo if t and elev.in_japan(*t[0]) and elev.in_japan(*t[1])} - set(SLOPE)
        allowed = not new or SLOPE_RATE.take(self.client(), n=len(new))

        def one(t):
            if not t:
                return {}
            a, b = t
            k = slope_key(a, b)
            if k in SLOPE:
                return SLOPE[k]
            if not (elev.in_japan(*a) and elev.in_japan(*b)):
                return {}
            if not allowed:
                return None
            line = enrich.leg_line(a, b, 'walk', LEGS)
            if not line:
                return None
            try:
                got = elev.slope(line)
            except elev.Busy:
                return None
            SLOPE[k] = got
            return got
        had = len(LEGS), len(SLOPE)
        with ThreadPoolExecutor(2) as ex:
            out = list(ex.map(one, todo))
        if len(LEGS) != had[0] or len(SLOPE) != had[1]:
            with SAVE_LOCK:
                if len(LEGS) != had[0]:
                    save_json(LEGS_PATH, LEGS)
                if len(SLOPE) != had[1]:
                    save_json(SLOPE_PATH, SLOPE)
        try:
            return self.send_json(200, {'slopes': out})
        except (BrokenPipeError, ConnectionResetError):
            return None

    def static(self, path):
        rel = os.path.normpath(path.lstrip('/')) if path not in ('', '/') else 'index.html'
        root = os.path.realpath(WEB)
        full = os.path.realpath(os.path.join(root, rel))
        if os.path.commonpath([root, full]) != root or not os.path.isfile(full):
            full = os.path.join(root, 'index.html')
        if not os.path.isfile(full):
            return self.send_json(503, {'error': 'build web first'})
        ctype = TYPES.get(os.path.splitext(full)[1].lower(), 'application/octet-stream')
        data = open(full, 'rb').read()
        hashed = os.path.commonpath([os.path.join(root, 'assets'), full]) == os.path.join(root, 'assets')
        can = os.path.splitext(full)[1].lower() in ZIP_TYPES and len(data) > ZIP_MIN
        zipped = can and self.wants_gzip()
        if zipped:
            data = gzipped(full, data)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable' if hashed else 'no-cache')
        if can:
            self.send_header('Vary', 'Accept-Encoding')
        if zipped:
            self.send_header('Content-Encoding', 'gzip')
        self.end_headers()
        self.write_body(data)


if __name__ == '__main__':
    print(f'IntenTrip http://0.0.0.0:{PORT}', flush=True)
    for name in ('sample.json', 'sample.en.json'):
        gplaces.learn((load(os.path.join(HERE, name)) or {}).get('places') or [])
    threading.Thread(target=sweep_expired, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
