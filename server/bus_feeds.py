# 日本中の時刻表（GTFS）の一覧から、エリアに関わる物を選ぶ。出どころは 3 つ。
#   - ODPT 会員ポータルの一覧（members-portal.odpt.org。事業者ごとに聞く。鍵は要らない）。ファイルは api.odpt.org（鍵が要る）
#   - ODPT のデータカタログ（CKAN）にだけある物（都営・東京メトロなど）。CKAN の API は閉じているので、DATA に写してある
#   - GTFS データリポジトリ（api.gtfs-data.jp。範囲で絞った一覧を返す。鍵は要らない）
# 使うのは、出典の表示だけで済むライセンス（公共交通オープンデータ基本ライセンス・CC BY・CC0）の物だけ。
# 同じ条件での再配布を求める物（CC BY-SA・ODbL など）、チャレンジ限定・特定利用条件の付いた物、GTFS-RU ライセンスの物は使わない。
# 予約して乗る（デマンド）・乗れる人が決まっている物も、観光客は乗れないので使わない。
# ODPT の物の範囲（停留所を囲む四角）と大きさは bus_catalog.json に置く（python3 bus_feeds.py --seed で作り直す）。
import json, math, os, re, sys, threading, time, unicodedata, urllib.error, urllib.parse, urllib.request, zlib
from concurrent.futures import ThreadPoolExecutor

import places

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(HERE, 'bus_catalog.json')
UA = places.UA
PORTAL = 'https://members-portal.odpt.org/api/v1/resources'
GTFSJP_FILES = 'https://api.gtfs-data.jp/v2/files?extent={w},{s},{e},{n}'
GTFSJP_FEED = 'https://api.gtfs-data.jp/v2/organizations/{org}/feeds/{feed}'
GTFSJP_FEEDS = 'https://api.gtfs-data.jp/v2/feeds'
GTFSJP_ZIP = 'https://api.gtfs-data.jp/v2/organizations/{org}/feeds/{feed}/files/feed.zip?uid={uid}'
LIST_TTL = 86400                   # 一覧を聞き直す間隔
GRID = 0.1                         # 範囲で絞った一覧を覚えておく升目・停留所のある升目（度）
MAX_SIDE = 0.6                     # 1 つのエリアの範囲の上限（度。60 km ほど）
MIN_STOPS = 2                      # エリアの中にこれより少ない停留所しか無い時刻表（高速バスなど）は使わない

LICENSES = {
    'odpt': ('公共交通オープンデータ基本ライセンス', 'https://developer.odpt.org/terms/data_basic_license.html'),
    'CC BY 4.0': ('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/deed.ja'),
    'CC BY 2.1 JP': ('CC BY 2.1 JP', 'https://creativecommons.org/licenses/by/2.1/jp/'),
    'CC0 1.0': ('CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/deed.ja'),
}
RED = ('チャレンジ', '限定公開', '期間限定', '事前に', '承認', '許可', '禁じ', 'GTFS-RU')
NOT_FOR_VISITORS = ('デマンド', '予約', '利用対象者', '乗車証', 'オンデマンド')

# 名前を決めてある物（短い名前と、ファイルの名前に使う印）。それ以外はデータの名前から作る。
# agencyEn・nameEn・titleEn は英語の画面に出す名前（無ければ時刻表の translations.txt の英語か、日本語のまま）
NAMES = {
    'odpt:KyotoMunicipalTransportation/Kyoto_City_Bus_GTFS': {'id': 'city', 'agency': '市バス', 'agencyEn': 'City Bus',
                                                              'nameEn': 'Kyoto Municipal Transportation Bureau', 'titleEn': 'Kyoto City Bus'},
    'odpt:KyotoBus/AllLines': {'id': 'kyotobus', 'agency': '京都バス', 'agencyEn': 'Kyoto Bus', 'nameEn': 'Kyoto Bus', 'titleEn': 'Kyoto Bus'},
    'odpt:YokohamaMunicipal/Bus': {'agency': '横浜市営バス', 'agencyEn': 'Yokohama City Bus'},
    'odpt:YokohamaMunicipal/Train': {'agency': '横浜市営地下鉄', 'agencyEn': 'Yokohama Municipal Subway'},
    'odpt:IzuhakoneBus/IZHB': {'agency': '伊豆箱根バス', 'agencyEn': 'Izuhakone Bus'},
    'odpt:TransportationBureau_CityOfKawasaki/AllLines': {'agency': '川崎市バス', 'agencyEn': 'Kawasaki City Bus'},
    'odpt:SendaiMunicipal/bus_realtime_information': {'agency': '仙台市営バス', 'agencyEn': 'Sendai City Bus'},
    'odpt:TokyoChuoCity/Alldata': {'agency': '江戸バス', 'agencyEn': 'Edo Bus'},
    'odpt:TokyoTaitoCity/megurinCCBY40': {'agency': 'めぐりん', 'agencyEn': 'Megurin'},
}

# CKAN にだけある物（2026-11-06 に CKAN の各ページで、ライセンスと出典の書き方を確かめて写した）
DATA = (
    {'key': 'data:Toei/ToeiBus-GTFS', 'url': 'https://api-public.odpt.org/api/v4/files/Toei/data/ToeiBus-GTFS.zip', 'needKey': False,
     'agency': '都営バス', 'agencyEn': 'Toei Bus', 'name': '東京都交通局・公共交通オープンデータ協議会', 'title': '東京都交通局 バス関連情報', 'license': 'CC BY 4.0', 'mode': 'bus'},
    {'key': 'data:Toei/Toei-Train-GTFS', 'url': 'https://api-public.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip', 'needKey': False,
     'agency': '都営', 'agencyEn': 'Toei', 'name': '東京都交通局・公共交通オープンデータ協議会', 'title': '東京都交通局 鉄道関連情報', 'license': 'CC BY 4.0', 'mode': 'railway'},
    {'key': 'data:TokyoMetro/TokyoMetro-Train-GTFS', 'url': 'https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip', 'needKey': True,
     'agency': '東京メトロ', 'agencyEn': 'Tokyo Metro', 'name': '東京地下鉄', 'title': '東京メトロ 鉄道関連情報', 'license': 'odpt', 'mode': 'railway'},
    {'key': 'data:TWR/TWR-Train-GTFS', 'url': 'https://api.odpt.org/api/v4/files/TWR/data/TWR-Train-GTFS.zip', 'needKey': True,
     'agency': 'りんかい線', 'name': '東京臨海高速鉄道', 'title': '東京臨海高速鉄道 鉄道関連情報', 'license': 'odpt', 'mode': 'railway'},
    {'key': 'data:MIR/MIR-Train-GTFS', 'url': 'https://api.odpt.org/api/v4/files/MIR/data/MIR-Train-GTFS.zip', 'needKey': True,
     'agency': 'つくばエクスプレス', 'name': '首都圏新都市鉄道', 'title': '首都圏新都市鉄道 鉄道関連情報', 'license': 'odpt', 'mode': 'railway'},
    {'key': 'data:TamaMonorail/TamaMonorail-Train-GTFS', 'url': 'https://api.odpt.org/api/v4/files/TamaMonorail/data/TamaMonorail-Train-GTFS.zip', 'needKey': True,
     'agency': '多摩モノレール', 'name': '多摩都市モノレール', 'title': '多摩都市モノレール 鉄道関連情報', 'license': 'odpt', 'mode': 'railway'},
    {'key': 'data:SeibuBus/SeibuBus-GTFS', 'url': 'https://api.odpt.org/api/v4/files/SeibuBus/data/SeibuBus-GTFS.zip', 'needKey': True,
     'agency': '西武バス', 'name': '西武バス', 'title': '西武バス バス関連情報', 'license': 'odpt', 'mode': 'bus'},
    {'key': 'data:JoetsuCity/data-1', 'url': 'https://api.odpt.org/api/v4/files/JoetsuCity/data/data-1.zip', 'needKey': True,
     'agency': '上越市営バス', 'name': '上越市', 'title': '上越市（新潟県） バス関連情報', 'license': 'odpt', 'mode': 'bus'},
    {'key': 'data:MitoyoCity/data-1', 'url': 'https://api-public.odpt.org/api/v4/files/MitoyoCity/data/data-1.zip', 'needKey': False,
     'agency': '三豊市コミュニティバス', 'name': '三豊市', 'title': '三豊市（香川県） バス関連情報', 'license': 'CC BY 4.0', 'mode': 'bus'},
    {'key': 'data:ShodoshimaTown/data-1', 'url': 'https://api-public.odpt.org/api/v4/files/ShodoshimaTown/data/data-1.zip', 'needKey': False,
     'agency': '小豆島町営バス', 'name': '小豆島町', 'title': '小豆島町（香川県） バス関連情報', 'license': 'CC BY 4.0', 'mode': 'bus'},
)


def nfkc(s):
    return unicodedata.normalize('NFKC', s or '').strip()


def safe_id(key):
    s = re.sub(r'[^A-Za-z0-9_.-]+', '_', key)
    return s[:80]


# ---- 範囲（南, 西, 北, 東） ----
def box_of(points, margin_m=0):
    lats = [p[0] for p in points]
    lngs = [p[1] for p in points]
    dlat = margin_m / 111320
    dlng = dlat / max(0.1, math.cos(math.radians(sum(lats) / len(lats))))
    return (min(lats) - dlat, min(lngs) - dlng, max(lats) + dlat, max(lngs) + dlng)


def clip(box, side=MAX_SIDE):
    """大きすぎる範囲は、真ん中の side 度四方にする"""
    s, w, n, e = box
    if n - s > side:
        c = (s + n) / 2
        s, n = c - side / 2, c + side / 2
    if e - w > side:
        c = (w + e) / 2
        w, e = c - side / 2, c + side / 2
    return (s, w, n, e)


def snap(box, step=GRID):
    s, w, n, e = box
    f = lambda x: round(math.floor(x / step + 1e-9) * step, 4)
    c = lambda x: round(math.ceil(x / step - 1e-9) * step, 4)
    return (f(s), f(w), c(n), c(e))


def cell_of(lat, lng):
    return f'{math.floor(lat / GRID + 1e-9)}:{math.floor(lng / GRID + 1e-9)}'


def cells_in(box):
    s, w, n, e = box
    out = set()
    for i in range(math.floor(s / GRID + 1e-9), math.floor(n / GRID + 1e-9) + 1):
        for j in range(math.floor(w / GRID + 1e-9), math.floor(e / GRID + 1e-9) + 1):
            out.add(f'{i}:{j}')
    return out


def stops_in(entry, box):
    """box の中の停留所の数。停留所の場所があればそれで、無ければ升目ごとの数で（升目の分だけ多めに数える）"""
    if not entry.get('bbox') or not intersects(entry['bbox'], box):
        return 0
    if entry.get('pts'):
        return sum(1 for la, lo in entry['pts'] if box[0] <= la <= box[2] and box[1] <= lo <= box[3])
    cells = entry.get('cells')
    if not isinstance(cells, dict):
        return entry.get('stops') or 2
    return sum(cells.get(c, 0) for c in cells_in(box))


def cells_of(points):
    out = {}
    for la, lo in points:
        c = cell_of(la, lo)
        out[c] = out.get(c, 0) + 1
    return dict(sorted(out.items()))


def intersects(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def contains(outer, inner):
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


# ---- ライセンスと名前 ----
def odpt_license(ds):
    """会員ポータルの物のライセンス。使わない物は None"""
    lic = {'ODPT基本': 'odpt', 'CC BY 4.0': 'CC BY 4.0', 'CC0': 'CC0 1.0'}.get(ds.get('license_type') or '')
    if not lic or (ds.get('license_name_ja') or '').strip() or (ds.get('license_url_ja') or '').strip():
        return None
    text = ' '.join(str(ds.get(k) or '') for k in ('explain_ja', 'license_explain', 'name_ja'))
    if any(w in text for w in RED) or any(w in text for w in NOT_FOR_VISITORS):
        return None
    return lic


def gtfsjp_license(x):
    """GTFS データリポジトリの物のライセンス。使わない物は None"""
    raw = nfkc(x.get('feed_license_id') or x.get('feed_license'))
    url = x.get('feed_license_url') or ''
    up = raw.upper()
    if any(w in up for w in ('SA', 'ND', 'NC', 'ODBL')) or any(w in url for w in ('-sa', '-nd', '-nc', 'odbl')):
        return None
    if up.startswith('CC0'):
        return 'CC0 1.0'
    if 'BY' in up:
        if '2.1' in up or '/2.1/' in url:
            return 'CC BY 2.1 JP'
        return 'CC BY 4.0'
    return None


GENERIC = ('全線', '路線バス', '一般路線', '路線情報', 'バス関連情報', '鉄道関連情報', 'コミュニティバス', '市営バス', '町営バス', '村営バス', 'バス')
TRANSIT = ('バス', '号', '線', '地下鉄', '電車', '鉄道', 'トラム', 'ライナー', 'モノレール', 'ぐる', 'りん', '交通')


def short_name(title, org=''):
    """データの名前から、画面に出す短い名前（伊豆箱根バス株式会社 → 伊豆箱根バス、千代田区地域福祉交通「風ぐるま」→ 風ぐるま）"""
    t = nfkc(title)
    for w in ('株式会社', '(株)', '有限会社'):
        t = t.replace(w, '')
    quoted = re.findall(r'[「『]([^」』]+)[」』]', t)
    paren = [p for p in re.findall(r'[(（]([^)）]+)[)）]', t) if any(w in p for w in TRANSIT) and not re.search(r'\d{4}', p)]
    bare = re.sub(r'[「『][^」』]*[」』]|[(（][^)）]*[)）]', ' ', t)
    tokens = [x for x in re.split(r'[\s/、・]+', bare) if x and x not in GENERIC and not x.endswith('関連情報')]
    for c in quoted + tokens + paren:
        c = re.sub(r'(路線情報|路線バス|全線|GTFS)$', '', c).strip()
        if c and c not in GENERIC and any(w in c for w in TRANSIT):
            return c[:24]
    org = nfkc(org).replace('株式会社', '').strip()
    base = tokens[0] if tokens else ''
    if org and (not base or base in GENERIC):
        return f'{org}{base or "バス"}'[:24]
    return (base or org or 'バス')[:24]


def gtfsjp_short(x):
    feed = nfkc(x.get('feed_name'))
    org = nfkc(x.get('organization_name'))
    if not feed or feed in GENERIC or feed in ('路線バス', 'コミュニティバス') or feed == org:
        return short_name(f'{org}{feed}' if feed != org else org, org)
    quoted = re.findall(r'[「『]([^」』]+)[」』]', feed)
    if quoted:
        return quoted[0][:24]
    return short_name(feed, org)


# ---- 置いてある範囲（ODPT の物） ----
def load_seed(path=SEED_PATH):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d.get('feeds') or {}
    except (OSError, ValueError):
        return {}


def _get_json(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'}), timeout=timeout) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip' or raw[:2] == b'\x1f\x8b':
            raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
    return json.loads(raw)


def odpt_versions(ds):
    """会員ポータルの物の版（date=YYYYMMDD で取れる物）"""
    out = []
    for res in ds.get('dataresource') or []:
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(res.get('url') or '').query)
        date = (q.get('date') or [''])[0]
        if re.fullmatch(r'\d{8}', date):
            out.append({'res': date, 'uploaded': res.get('uploaded_at') or '', 'version': res.get('feed_version') or '',
                        'end': (res.get('feed_end_date') or '').replace('-', '')})
    return out


def odpt_feed(org, ds, seed):
    """会員ポータルの事業者と物から、探す係が使う形にする（使わない物は None）"""
    if (ds.get('format_type') or '') != 'GTFS/GTFS-JP':
        return None
    modes = ds.get('mode_list') or []
    if not any(m in ('bus', 'railway') for m in modes):
        return None
    lic = odpt_license(ds)
    if not lic:
        return None
    key = f"odpt:{org.get('label')}/{ds.get('label')}"
    known = NAMES.get(key, {})
    title = nfkc(ds.get('name_ja'))
    return {'key': key, 'id': known.get('id') or safe_id(key), 'kind': 'odpt', 'org': org.get('label'), 'ds': ds.get('label'),
            'agency': known.get('agency') or short_name(title, org.get('name_ja')), 'name': nfkc(org.get('name_ja')).replace('株式会社', '').strip(),
            'title': title, 'license': lic, 'via': 'ODPT', 'mode': 'railway' if 'railway' in modes else 'bus',
            'bbox': (seed.get(key) or {}).get('bbox'), 'bytes': (seed.get(key) or {}).get('bytes', 0),
            'versions': odpt_versions(ds), **{k: known[k] for k in ('agencyEn', 'nameEn', 'titleEn') if known.get(k)}}


def data_feed(d, seed):
    s = seed.get(d['key']) or {}
    return {**d, 'id': safe_id(d['key']), 'kind': 'data', 'via': 'ODPT', 'bbox': s.get('bbox'), 'bytes': s.get('bytes', 0), 'versions': []}


def gtfsjp_feed(x, info=None):
    """範囲で絞った一覧の 1 件（info は全体の一覧の同じ物。説明・終わったか）から、探す係が使う形にする"""
    lic = gtfsjp_license(x)
    if not lic or (info or {}).get('feed_is_discontinued'):
        return None
    text = ' '.join(nfkc(v) for v in (x.get('feed_name'), x.get('organization_name'), (info or {}).get('feed_memo')))
    if any(w in text for w in NOT_FOR_VISITORS) or any(w in text for w in RED):
        return None
    org, feed = x.get('organization_id') or '', x.get('feed_id') or ''
    if not org or not feed or not x.get('file_uid'):
        return None
    key = f'gtfsjp:{org}/{feed}'
    ver = {'res': x['file_uid'], 'start': (x.get('file_from_date') or '').replace('-', ''), 'end': (x.get('file_to_date') or '').replace('-', ''),
           'uploaded': x.get('file_published_at') or ''}
    return {'key': key, 'id': safe_id(key), 'kind': 'gtfsjp', 'org': org, 'feed': feed, 'agency': gtfsjp_short(x),
            'name': nfkc(x.get('organization_name')), 'title': nfkc(x.get('feed_name')), 'license': lic,
            'licenseUrl': x.get('feed_license_url') or LICENSES[lic][1], 'via': 'GTFSデータリポジトリ', 'mode': 'bus',
            'bbox': None, 'bytes': 0, 'versions': [ver], 'stopsUrl': x.get('file_stop_url') or ''}


def norm_org(s):
    s = nfkc(s)
    for w in ('株式会社', '(株)', '有限会社', '一般社団法人', '交通局', '道路交通課', ' ', '　'):
        s = s.replace(w, '')
    return s


class Directory:
    """エリアの範囲に関わる時刻表を選ぶ。一覧は 1 日ごとに聞き直し、取れなければ前の一覧を使う"""

    def __init__(self, cache_dir, now=time.time, get_json=_get_json, seed=None):
        self.dir, self.now, self.get_json = cache_dir, now, get_json
        self.seed = load_seed() if seed is None else seed
        self.lock = threading.Lock()
        self.memo = {}                 # 聞いた一覧（印 → (取った時刻, 中身)）
        os.makedirs(self.dir, exist_ok=True)

    def _cached(self, name, fetch):
        """name の一覧。新しければ覚えている物・置いてある物を使い、古ければ聞き直す。聞けなければ古い物を 10 分使う"""
        path = os.path.join(self.dir, f'list-{name}.json')
        with self.lock:
            hit = self.memo.get(name)
        if hit is None:
            try:
                with open(path, encoding='utf-8') as f:
                    disk = json.load(f)
                hit = (disk['at'], disk['body'])
            except (OSError, ValueError, KeyError):
                hit = None
        if hit and self.now() - hit[0] < LIST_TTL:
            with self.lock:
                self.memo[name] = hit
            return hit[1]
        try:
            body = fetch()
            at = self.now()
            try:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump({'at': at, 'body': body}, f, ensure_ascii=False)
            except OSError:
                pass
        except Exception as e:  # noqa: BLE001
            print(f'[bus] 一覧 {name} を取れませんでした（{type(e).__name__}）', flush=True)
            body = hit[1] if hit else None
            at = self.now() - LIST_TTL + 600
        with self.lock:
            self.memo[name] = (at, body)
        return body

    def odpt_org(self, org):
        url = f'{PORTAL}?organization={urllib.parse.quote(org)}'
        return self._cached(f'odpt-{safe_id(org)}', lambda: self.get_json(url)) or []

    def gtfsjp_area(self, box):
        s, w, n, e = box
        url = GTFSJP_FILES.format(s=s, w=w, n=n, e=e)
        body = self._cached(f'gtfsjp-{s}_{w}_{n}_{e}', lambda: (self.get_json(url) or {}).get('body'))
        return body if isinstance(body, list) else []

    def gtfsjp_all(self):
        """全体の一覧（説明・終わったかを見るため。1 日 1 回）。(組織, 物) → 1 件"""
        body = self._cached('gtfsjp-feeds', lambda: (self.get_json(GTFSJP_FEEDS, timeout=30) or {}).get('body'))
        return {(x.get('organization_id'), x.get('feed_id')): x for x in body or []}

    def gtfsjp_stops(self, f):
        """その版の停留所の升目ごとの数（stops.geojson から。版ごとに覚える）"""
        if not f.get('stopsUrl'):
            return None
        uid = f['versions'][0]['res'] if f.get('versions') else ''

        def fetch():
            d = self.get_json(f['stopsUrl'])
            pts = []
            for x in (d or {}).get('features') or []:
                c = (x.get('geometry') or {}).get('coordinates') or []
                if len(c) >= 2 and str((x.get('properties') or {}).get('location_type') or '0') in ('', '0'):
                    pts.append((float(c[1]), float(c[0])))
            if not pts:
                return None
            lats, lngs = [p[0] for p in pts], [p[1] for p in pts]
            return {'bbox': [min(lats), min(lngs), max(lats), max(lngs)], 'stops': len(pts), 'cells': cells_of(pts),
                    'pts': [[round(la, 4), round(lo, 4)] for la, lo in pts[:5000]]}
        return self._cached(f'gtfsjp-stops-{safe_id(uid)}', fetch)

    def gtfsjp_detail(self, f):
        url = GTFSJP_FEED.format(org=urllib.parse.quote(f['org']), feed=urllib.parse.quote(f['feed']))
        return self._cached(f'gtfsjp-feed-{f["id"]}', lambda: (self.get_json(url) or {}).get('body')) or {}

    def feeds(self, box):
        """範囲 box（南, 西, 北, 東）に停留所がかかる時刻表（ODPT の物を先に。同じ事業者が両方にあれば ODPT の物）"""
        box = clip(box)
        area = snap(box)
        out, orgs = [], {}
        for key, s in self.seed.items():
            if stops_in(s, box) < MIN_STOPS:
                continue
            if key.startswith('odpt:'):
                orgs.setdefault(key[5:].split('/')[0], []).append(key)
            elif key.startswith('data:'):
                d = next((x for x in DATA if x['key'] == key), None)
                if d:
                    out.append(data_feed(d, self.seed))
        for org, keys in orgs.items():
            for o in self.odpt_org(org):
                if o.get('label') != org:
                    continue
                for ds in o.get('datasets') or []:
                    f = odpt_feed(o, ds, self.seed)
                    if f and f['key'] in keys:
                        out.append(f)
        out = self._dedupe(out)
        have = {norm_org(f['name']) for f in out}
        found = self.gtfsjp_area(area)
        everything = self.gtfsjp_all() if found else {}
        cands = []
        for x in found:
            f = gtfsjp_feed(x, everything.get((x.get('organization_id'), x.get('feed_id'))))
            if f and norm_org(f['name']) not in have:
                cands.append(f)
        with ThreadPoolExecutor(3) as ex:
            stops = list(ex.map(self.gtfsjp_stops, cands))
        for f, st in zip(cands, stops):
            if st and stops_in(st, box) < MIN_STOPS:
                continue
            f['bbox'] = (st or {}).get('bbox')
            out.append(f)
        return self._dedupe(out)

    @staticmethod
    def _dedupe(feeds):
        """同じ事業者が同じ名前で出している物（京都バスの 2 つの形・東大和市の 3 つのライセンス）は 1 つにする"""
        rank = {'CC0 1.0': 0, 'CC BY 4.0': 1, 'CC BY 2.1 JP': 1, 'odpt': 2}
        best = {}
        for f in feeds:
            k = (f.get('kind'), norm_org(f['name']), f.get('title'))
            cur = best.get(k)
            pref = (0 if f['key'] in NAMES and NAMES[f['key']].get('id') else 1, rank.get(f['license'], 3), f['key'])
            if cur is None or pref < cur[0]:
                best[k] = (pref, f)
        keep = {id(v[1]) for v in best.values()}
        return [f for f in feeds if id(f) in keep]

    def versions(self, feed):
        """その物の版の一覧（res・start・uploaded）。都営などの決まった URL の物は空（current を使う）"""
        if feed.get('kind') == 'gtfsjp':
            lst = list(feed.get('versions') or [])
            cur = lst[0] if lst else None
            today = int(time.strftime('%Y%m%d', time.localtime(self.now())))
            soon = int(time.strftime('%Y%m%d', time.localtime(self.now() + 60 * 86400)))
            if not cur or (cur.get('end') and int(cur['end']) < soon) or (cur.get('start') and int(cur['start']) > today):
                for g in (self.gtfsjp_detail(feed).get('gtfs_files') or []):
                    if g.get('gtfs_file_uid') and g['gtfs_file_uid'] not in {x['res'] for x in lst}:
                        lst.append({'res': g['gtfs_file_uid'], 'start': (g.get('from_date') or '').replace('-', ''),
                                    'end': (g.get('to_date') or '').replace('-', ''), 'uploaded': g.get('published_at') or ''})
            return lst
        if feed.get('kind') == 'data':
            return []
        if feed.get('versions') is not None and feed.get('kind') == 'odpt':
            return feed['versions']
        for o in self.odpt_org(feed['org']):
            for ds in o.get('datasets') or []:
                if ds.get('label') == feed['ds']:
                    return odpt_versions(ds)
        return []


def credit(feed):
    """出典の表示に要る物（事業者の名前・データの名前・ライセンスとその URL・どこから取ったか）"""
    lic = feed.get('license') or 'odpt'
    name, url = LICENSES.get(lic, (lic, ''))
    return {'name': feed.get('name') or feed.get('agency'), 'title': feed.get('title') or '', 'license': lic, 'licenseName': name,
            'licenseUrl': feed.get('licenseUrl') or url, 'via': feed.get('via') or 'ODPT',
            **{k: feed[k] for k in ('nameEn', 'titleEn') if feed.get(k)}}


# ---- bus_catalog.json を作る（ODPT の物の停留所の範囲。zip の中の stops.txt だけを取る） ----
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _locate(url):
    op = urllib.request.build_opener(_NoRedirect)
    try:
        with op.open(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as r:
            return url if r.status == 200 else None
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            return e.headers.get('Location')
        raise RuntimeError(f'http {e.code}') from None


def _range(url, a, b):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Range': f'bytes={a}-{b}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        total = int((r.headers.get('Content-Range') or '/0').rsplit('/', 1)[-1] or 0)
        return r.status, r.read(), total


def stops_of(url):
    """zip の中の stops.txt を、zip の末尾の目次から場所を見つけて、その部分だけ取る。(stops.txt の中身, zip の大きさ)"""
    import struct
    loc = _locate(url)
    st, head, total = _range(loc, 0, 0)
    if st != 206 or not total:
        raise RuntimeError('range')
    tail_len = min(total, 1 << 18)
    _, tail, _ = _range(loc, total - tail_len, total - 1)
    i = tail.rfind(b'PK\x05\x06')
    if i < 0:
        raise RuntimeError('eocd')
    cd_size, cd_off = struct.unpack('<II', tail[i + 12:i + 20])
    base = total - tail_len
    if cd_off < base:
        _, cd, _ = _range(loc, cd_off, cd_off + cd_size - 1)
    else:
        cd = tail[cd_off - base:cd_off - base + cd_size]
    p = 0
    while p + 46 <= len(cd) and cd[p:p + 4] == b'PK\x01\x02':
        method, = struct.unpack('<H', cd[p + 10:p + 12])
        csize, = struct.unpack('<I', cd[p + 20:p + 24])
        nlen, xlen, clen = struct.unpack('<HHH', cd[p + 28:p + 34])
        off, = struct.unpack('<I', cd[p + 42:p + 46])
        name = cd[p + 46:p + 46 + nlen].decode('utf-8', 'replace')
        p += 46 + nlen + xlen + clen
        if name.rsplit('/', 1)[-1].lower() != 'stops.txt':
            continue
        _, lh, _ = _range(loc, off, off + 29)
        ln, lx = struct.unpack('<HH', lh[26:30])
        start = off + 30 + ln + lx
        _, data, _ = _range(loc, start, start + csize - 1)
        raw = zlib.decompress(data, -15) if method == 8 else data
        return raw.decode('utf-8-sig', 'replace'), total
    raise RuntimeError('no stops.txt')


def bbox_of_stops(text):
    """(四角, 停留所の数, 升目ごとの停留所の数)"""
    import csv, io
    lats, lngs = [], []
    for s in csv.DictReader(io.StringIO(text)):
        s = {k.strip(): v for k, v in s.items() if k}
        if s.get('location_type') not in ('', '0', None):
            continue
        try:
            la, lo = float(s['stop_lat']), float(s['stop_lon'])
        except (KeyError, ValueError, TypeError):
            continue
        if 20 < la < 50 and 120 < lo < 155:
            lats.append(la)
            lngs.append(lo)
    if not lats:
        return None, 0, []
    return [round(min(lats), 4), round(min(lngs), 4), round(max(lats), 4), round(max(lngs), 4)], len(lats), cells_of(zip(lats, lngs))


def dumps_seed(feeds):
    """1 つの時刻表を 1 行にして書く（差分を見やすくする）"""
    lines = [f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, separators=(",", ":"))}' for k, v in sorted(feeds.items())]
    return '{"made": "%s", "feeds": {\n%s\n}}\n' % (time.strftime('%Y-%m-%d'), ',\n'.join(lines))


def seed(key_path):
    """ODPT の物の停留所の範囲を調べて bus_catalog.json に書く。1 つずつ、間を空けて取る"""
    with open(os.path.expanduser(key_path), encoding='utf-8') as f:
        key = f.read().strip()
    today = time.strftime('%Y%m%d')
    targets = []
    for o in _get_json(PORTAL, timeout=60):
        for ds in o.get('datasets') or []:
            f = odpt_feed(o, ds, {})
            if not f:
                continue
            vs = [v for v in f['versions'] if not v['end'] or v['end'] >= today]
            if not vs:
                continue
            ok = [v for v in vs if v['res'] <= today] or vs
            res = max(ok, key=lambda v: (v['res'], v['uploaded']))['res']
            url = f"https://api.odpt.org/api/v4/files/odpt/{f['org']}/{f['ds']}.zip?date={res}&acl:consumerKey={urllib.parse.quote(key)}"
            targets.append((f['key'], url))
    for d in DATA:
        url = d['url'] + (f'?acl:consumerKey={urllib.parse.quote(key)}' if d['needKey'] else '')
        targets.append((d['key'], url))
    out = {}
    for k, url in targets:
        try:
            text, size = stops_of(url)
            bbox, n, cells = bbox_of_stops(text)
            if bbox:
                out[k] = {'bbox': bbox, 'bytes': size, 'stops': n, 'cells': cells}
            print(f'{k}: {n} 停留所・{size // 1024} KB', flush=True)
        except Exception as e:  # noqa: BLE001
            print(f'{k}: 取れませんでした（{type(e).__name__}: {str(e)[:40]}）', flush=True)
        time.sleep(1.0)
    with open(SEED_PATH, 'w', encoding='utf-8') as f:
        f.write(dumps_seed(out))
    print(f'{len(out)} 件を書きました', flush=True)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--seed':
        seed(sys.argv[2])
    else:
        print('使い方: python3 bus_feeds.py --seed <ODPT の鍵を書いたファイル>')
