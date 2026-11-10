# Google の Places API (New) を呼ぶ（標準ライブラリの urllib で）。
#   search(query, …)    … 名前から場所を探す（Text Search・Pro のフィールドだけ）
#   location(place_id)  … place_id から位置（Place Details・Essentials のフィールドだけ）
#   locate(plist, area) … 候補ごとに place_id と位置を照合する（search を場所ごとに 1 回。プランに入りやすい候補から）
#   learn(plist)        … 照合済みの place_id を覚える（同じ名前の候補は、次から呼ばずに place_id を付ける）
#   find(p, area)       … まだ照合していない候補の場所の画面を開いたときに、その 1 か所だけ照合する（画面の枠を使う）
#   expire(plist)       … 位置を取って 30 日を過ぎた候補を、照合の前の位置に戻す（呼び出しなし）
#   details(place_id)   … 評価・営業時間・Google マップの URL・写真 3 枚（場所の画面を開いたときだけ）
#   photo_uri(name, w)  … 写真の URL（Place Photo）
# 認証は、ZT_GCLOUD_TOKEN_CMD があればそのコマンドが出すトークン（手元）、なければ google-auth のサービス アカウント（Cloud Run）。
# ZT_PLACES_PROJECT（課金するプロジェクト）が無いときは使わない。呼び出しは 1 時間あたり ZT_PLACES_PER_HOUR（既定 300・0 で上限なし）まで。
# そのうち候補をまとめての照合（search・location）に使えるのは ZT_PLACES_BULK_PER_HOUR（既定はその 3 分の 1）までで、
# 残りは人が開いた場所の画面（details・photo・find）のために空けておく。
# 1 日（直前の 24 時間）の上限も同じ形で、ZT_PLACES_PER_DAY（既定 0＝上限なし）と ZT_PLACES_BULK_PER_DAY（既定はその 3 分の 1）。
# 数えるのはこのサーバーのメモリの中だけ（起動し直すと 0 から）。
# 規約で、サーバーに取っておいてよいのは place_id（期限なし）と緯度経度（30 日まで）だけ。
# 評価・営業時間・写真とその名前は、画面に返すだけで取っておかない。
import json, os, re, shlex, subprocess, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

import places

API = 'https://places.googleapis.com/v1'
SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
PROJECT = os.environ.get('ZT_PLACES_PROJECT', '').strip()
PER_HOUR = int(os.environ.get('ZT_PLACES_PER_HOUR', '300'))
BULK_PER_HOUR = int(os.environ.get('ZT_PLACES_BULK_PER_HOUR') or PER_HOUR // 3)
PER_DAY = int(os.environ.get('ZT_PLACES_PER_DAY', '0'))
BULK_PER_DAY = int(os.environ.get('ZT_PLACES_BULK_PER_DAY') or PER_DAY // 3)
BULK = ('search', 'location')
TOKEN_CMD = os.environ.get('ZT_GCLOUD_TOKEN_CMD', '').strip()
TOKEN_TTL = 300                      # コマンドで得たトークンを使い回す長さ（秒）
KEEP_DAYS = 30                       # Google の緯度経度を取っておける日数
WORKERS = 6                          # 照合を同時に問い合わせる数
SEARCH_FIELDS = 'places.id,places.location,places.displayName,places.formattedAddress,places.types,places.primaryTypeDisplayName'
# 「この付近で検索」（地図に写っている範囲で探す）。照合と見る物の枠とは別に、1 日の上限を持つ
AREA_PER_DAY = int(os.environ.get('ZT_PLACES_AREA_PER_DAY', '100'))
AREA_FIELDS = ('places.id,places.location,places.displayName,places.primaryType,places.primaryTypeDisplayName,places.rating,'
               'places.userRatingCount,places.regularOpeningHours.periods')
AREA_MAX = 12                        # 1 回に返す数
DETAIL_FIELDS = ('displayName,location,primaryType,rating,userRatingCount,regularOpeningHours.weekdayDescriptions,'
                 'regularOpeningHours.periods,googleMapsUri,photos')
PLACE_ID = re.compile(r'^[A-Za-z0-9_-]{10,300}$')
PHOTO_NAME = re.compile(r'^places/[A-Za-z0-9_-]{10,300}/photos/[A-Za-z0-9_-]{10,1200}$')

COUNT = {'search': 0, 'location': 0, 'details': 0, 'photo': 0, 'find': 0, 'area': 0}
DENIED = {'search': 0, 'location': 0, 'details': 0, 'photo': 0, 'find': 0, 'area': 0}
_times, _rate = [], threading.Lock()
_area_times = []
_said = {}
_tok, _tok_lock = {'v': '', 'at': 0.0, 'fail': 0.0, 'creds': None}, threading.Lock()


class Off(Exception):
    """Places を使えない（設定が無い・上限に届いた・トークンが取れない・問い合わせに失敗した）"""


def enabled():
    return bool(PROJECT)


def _token():
    with _tok_lock:
        now = time.time()
        if now - _tok['fail'] < 60:
            return ''
        if TOKEN_CMD:
            if _tok['v'] and now - _tok['at'] < TOKEN_TTL:
                return _tok['v']
            try:
                out = subprocess.run(shlex.split(TOKEN_CMD), capture_output=True, text=True, timeout=30, check=True).stdout.strip()
            except (OSError, ValueError, subprocess.SubprocessError):
                out = ''
        else:
            try:
                import google.auth
                import google.auth.transport.requests
                if _tok['creds'] is None:
                    _tok['creds'], _ = google.auth.default(scopes=[SCOPE])
                creds = _tok['creds']
                if not creds.valid:
                    creds.refresh(google.auth.transport.requests.Request())
                out = creds.token or ''
            except Exception:  # noqa: BLE001
                out = ''
        if not out:
            print('[places] トークンを取れませんでした', flush=True)
            _tok['fail'] = now
        _tok['v'], _tok['at'] = out, now
        return out


def _full(flags, cap, bulk_cap, bulk):
    """枠に届いていれば、その枠の言い方。flags は使った回ごとの「照合か」"""
    if cap <= 0:
        return ''
    if len(flags) >= cap:
        return f'{cap} 回'
    if bulk and sum(flags) >= bulk_cap:
        return f'照合の枠 {bulk_cap} 回'
    return ''


def _take(kind):
    """枠があれば 1 回分を使う。照合は照合の枠も見る。届いたら、種類ごとに 1 分に 1 回だけ記録に書く"""
    now = time.time()
    bulk = kind in BULK
    with _rate:
        _times[:] = [(t, b) for t, b in _times if now - t < (86400 if PER_DAY > 0 else 3600)]
        hour = [b for t, b in _times if now - t < 3600]
        why = _full(hour, PER_HOUR, BULK_PER_HOUR, bulk)
        span = '1 時間'
        if not why:
            why, span = _full([b for _, b in _times], PER_DAY, BULK_PER_DAY, bulk), '1 日'
        if why:
            DENIED[kind] += 1
            if now - _said.get(kind, 0) >= 60:
                _said[kind] = now
                print(f'[places] {span}あたりの上限（{why}）に届きました（{kind}・断った数 {DENIED[kind]}）', flush=True)
            return False
        _times.append((now, bulk))
        COUNT[kind] += 1
        return True


def _take_area():
    """「この付近で検索」の 1 日の枠があれば 1 回分を使う（照合と見る物の枠は使わない）"""
    now = time.time()
    with _rate:
        _area_times[:] = [t for t in _area_times if now - t < 86400]
        if AREA_PER_DAY > 0 and len(_area_times) >= AREA_PER_DAY:
            DENIED['area'] += 1
            if now - _said.get('area', 0) >= 60:
                _said['area'] = now
                print(f'[places] この付近で検索の 1 日の上限（{AREA_PER_DAY} 回）に届きました（断った数 {DENIED["area"]}）', flush=True)
            return False
        _area_times.append(now)
        COUNT['area'] += 1
        return True


def _call(kind, path, query=None, body=None, fields=''):
    """呼べないときは Off、見つからないときは None"""
    if not enabled():
        raise Off('off')
    tok = _token()
    if not tok:
        raise Off('token')
    if not (_take_area() if kind == 'area' else _take(kind)):
        raise Off('limit')
    headers = {'Authorization': 'Bearer ' + tok, 'X-Goog-User-Project': PROJECT}
    if fields:
        headers['X-Goog-FieldMask'] = fields
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    url = f'{API}/{path}' + ('?' + urllib.parse.urlencode(query) if query else '')
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=12) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            status = (json.loads(e.read() or b'{}').get('error') or {}).get('status') or ''
        except ValueError:
            status = ''
        print(f'[places] {kind} の呼び出しに失敗しました（{e.code} {status}）', flush=True)
        if e.code == 401:
            with _tok_lock:
                _tok['v'] = ''
        if e.code in (400, 404):
            return None
        raise Off(str(e.code)) from None
    except Exception as e:  # noqa: BLE001
        print(f'[places] {kind} の呼び出しに失敗しました（{type(e).__name__}）', flush=True)
        raise Off('net') from None


def search(query, center, radius_m, kind='search'):
    """Text Search → [{'id', 'name', 'lat', 'lng'}]（kind は数える枠。場所の画面から 1 か所だけなら 'find'）"""
    body = {'textQuery': query, 'languageCode': 'ja', 'regionCode': 'JP', 'pageSize': 5,
            'locationBias': {'circle': {'center': {'latitude': center[0], 'longitude': center[1]},
                                        'radius': max(1000.0, min(50000.0, radius_m))}}}
    d = _call(kind, 'places:searchText', body=body, fields=SEARCH_FIELDS) or {}
    out = []
    for x in d.get('places') or []:
        loc = x.get('location') or {}
        if x.get('id') and 'latitude' in loc and 'longitude' in loc:
            out.append({'id': x['id'], 'name': (x.get('displayName') or {}).get('text') or '',
                        'lat': float(loc['latitude']), 'lng': float(loc['longitude']),
                        'types': [t for t in x.get('types') or [] if isinstance(t, str)],
                        'label': (x.get('primaryTypeDisplayName') or {}).get('text') or ''})
    return out


# 見どころ・通りとして出さない場所の種類（Places の types）。名所の種類も持つ場所は残す
_NOT_SIGHT = {'convenience_store', 'supermarket', 'grocery_store', 'drugstore', 'pharmacy', 'electronics_store', 'cell_phone_store',
              'discount_store', 'hardware_store', 'home_improvement_store', 'auto_parts_store', 'car_dealer', 'car_rental', 'car_repair',
              'car_wash', 'gas_station', 'parking', 'bank', 'atm', 'finance', 'accounting', 'insurance_agency', 'real_estate_agency',
              'lawyer', 'travel_agency', 'corporate_office', 'consultant', 'employment_agency', 'post_office', 'courier_service',
              'storage', 'moving_company', 'laundry', 'hair_salon', 'beauty_salon', 'barber_shop', 'nail_salon', 'dentist', 'doctor',
              'hospital', 'medical_lab', 'gym', 'fitness_center', 'business_center', 'coworking_space',
              'telecommunications_service_provider', 'wholesaler', 'warehouse_store', 'department_store'}
_SIGHT = {'tourist_attraction', 'museum', 'art_gallery', 'historical_landmark', 'historical_place', 'monument', 'park', 'garden',
          'place_of_worship', 'church', 'hindu_temple', 'buddhist_temple', 'shinto_shrine', 'cultural_landmark', 'observation_deck',
          'sculpture', 'national_park', 'botanical_garden', 'zoo', 'aquarium', 'castle', 'plaza', 'cultural_center', 'library',
          'performing_arts_theater', 'visitor_center', 'market', 'spa', 'public_bath', 'hot_spring'}
_NOT_SIGHT_LABEL = re.compile(r'金券|チケットショップ|質屋|コンビニ|両替|ticket shop|pawn shop|convenience store', re.I)


def not_sight(p, hit):
    """見どころ・通りの候補が、照合した Places では名所でない店（金券ショップ・コンビニ・事務所など）か。
    人気スポット・希望に名前を書いた場所と、食事・休憩の店は外さない"""
    if p.get('kind') not in ('sight', 'street') or p.get('role') == 'famous' or p.get('named'):
        return False
    types = set(hit.get('types') or [])
    if types & _SIGHT:
        return False
    return bool(types & _NOT_SIGHT) or bool(_NOT_SIGHT_LABEL.search(f"{hit.get('label') or ''} {hit.get('name') or ''}"))


# 場所の種類（Places の primaryType）を、候補の種類（sight・street・food・cafe）に分ける
_CAFE = {'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop', 'confectionery', 'ice_cream_shop', 'juice_shop',
         'cafeteria', 'chocolate_shop', 'candy_store', 'donut_shop', 'pastry_shop', 'cat_cafe', 'dog_cafe'}
_FOOD = {'restaurant', 'food_court', 'meal_takeaway', 'meal_delivery', 'bar', 'pub', 'diner', 'bar_and_grill', 'wine_bar'}
_SHOP = {'market', 'shopping_mall', 'store', 'department_store', 'supermarket'}


def kind_of(ptype):
    t = str(ptype or '')
    if t in _CAFE or t.endswith('_cafe'):
        return 'cafe'
    if t in _FOOD or t.endswith('_restaurant'):
        return 'food'
    if t in _SHOP or t.endswith(('_store', '_shop', '_market')):
        return 'street'
    return 'sight'


def periods_of(hours):
    """Places の regularOpeningHours.periods → [[開く曜日, 開く分, 閉まる曜日, 閉まる分], …]（曜日は日曜が 0）。
    閉まる時刻の無い（24 時間営業の）ときは、閉まる曜日と分が None。分からなければ None"""
    out = []
    for p in (hours or {}).get('periods') or []:
        o, c = p.get('open') or {}, p.get('close') or {}
        if not isinstance(o.get('day'), int):
            continue
        om = int(o.get('hour') or 0) * 60 + int(o.get('minute') or 0)
        if isinstance(c.get('day'), int):
            out.append([o['day'], om, c['day'], int(c.get('hour') or 0) * 60 + int(c.get('minute') or 0)])
        else:
            out.append([o['day'], om, None, None])
    return out or None


def area_search(query, box, lang='ja'):
    """地図に写っている範囲（南, 西, 北, 東）の中だけを Text Search で探す →
    [{'id', 'name', 'lat', 'lng', 'type', 'kind', 'rating', 'count', 'hours'}]（取っておかずにそのまま返す）。
    hours は曜日ごとの営業時間（periods_of の形。分からなければ None）"""
    s, w, n, e = box
    body = {'textQuery': query, 'languageCode': 'en' if lang == 'en' else 'ja', 'regionCode': 'JP', 'pageSize': AREA_MAX,
            'locationRestriction': {'rectangle': {'low': {'latitude': s, 'longitude': w}, 'high': {'latitude': n, 'longitude': e}}}}
    d = _call('area', 'places:searchText', body=body, fields=AREA_FIELDS)
    if d is None:
        raise Off('bad')
    out = []
    for x in d.get('places') or []:
        loc = x.get('location') or {}
        if not x.get('id') or 'latitude' not in loc or 'longitude' not in loc:
            continue
        rating, count = x.get('rating'), x.get('userRatingCount')
        out.append({'id': x['id'], 'name': (x.get('displayName') or {}).get('text') or '',
                    'lat': float(loc['latitude']), 'lng': float(loc['longitude']),
                    'type': (x.get('primaryTypeDisplayName') or {}).get('text') or '',
                    'kind': kind_of(x.get('primaryType')),
                    'rating': float(rating) if isinstance(rating, (int, float)) else None,
                    'count': int(count) if isinstance(count, int) else None,
                    'hours': periods_of(x.get('regularOpeningHours'))})
    return out[:AREA_MAX]


def location(place_id):
    """place_id から位置（Place Details・Essentials のフィールドだけ）→ (lat, lng)。無ければ None"""
    if not PLACE_ID.match(place_id or ''):
        return None
    d = _call('location', f'places/{place_id}', fields='location') or {}
    loc = d.get('location') or {}
    if 'latitude' not in loc or 'longitude' not in loc:
        return None
    return float(loc['latitude']), float(loc['longitude'])


def _hours_text(s):
    s = re.sub(r'(\d{1,2})時(\d{2})分', lambda m: f'{int(m.group(1))}:{m.group(2)}', s)
    return s.replace('～', '〜').replace('~', '〜').replace(', ', '、').strip()


_CLOCK = re.compile(r'(\d{1,2})(?::(\d{2}))?(?:\s*([AP])M)?', re.I)
_RANGE = re.compile(r'(\d{1,2}(?::\d{2})?(?:\s*[AP]M)?)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)', re.I)


def _clock24(t, ampm):
    m = _CLOCK.fullmatch(t.strip())
    if not m:
        return t
    h, mm = int(m.group(1)), m.group(2) or '00'
    half = (m.group(3) or ampm).upper()
    if half == 'A' and h == 12:
        h = 0
    elif half == 'P' and h != 12:
        h += 12
    return f'{h}:{mm}'


def _hours_text_en(s):
    """英語の営業時間（「9:00 AM – 5:00 PM」「8:30 – 11:30 AM」）を、画面のほかの時刻と同じ 24 時間（「9:00–17:00」）にする"""
    s = ' '.join(s.split())

    def one(m):
        end = _CLOCK.fullmatch(m.group(2).strip())
        half = end.group(3) if end else ''
        return f'{_clock24(m.group(1), half)}–{_clock24(m.group(2), half)}'

    return _RANGE.sub(one, s)


def _author_uri(u):
    u = str(u or '')
    if u.startswith('//'):
        u = 'https:' + u
    return u if u.startswith('https://') else ''


def details(place_id, lang='ja'):
    """名前・位置・候補の種類・評価・営業時間（月曜から 7 日の言葉と、曜日ごとの periods）・Google マップの URL・写真 3 枚 → dict。
    無ければ None。営業時間の言葉と名前は画面の言語に合わせる（lang='en' なら英語）"""
    if not PLACE_ID.match(place_id or ''):
        return None
    d = _call('details', f'places/{place_id}', query={'languageCode': 'en' if lang == 'en' else 'ja', 'regionCode': 'JP'}, fields=DETAIL_FIELDS)
    if d is None:
        return None
    hours = []
    for line in (d.get('regularOpeningHours') or {}).get('weekdayDescriptions') or []:
        day, _, text = str(line).partition(': ')
        hours.append({'day': day.strip(), 'text': _hours_text(text) if lang != 'en' else _hours_text_en(text)})
    photos = []
    for ph in (d.get('photos') or [])[:3]:
        if PHOTO_NAME.match(ph.get('name') or ''):
            photos.append({'name': ph['name'], 'width': ph.get('widthPx'), 'height': ph.get('heightPx'),
                           'authors': [{'name': str(a.get('displayName') or ''), 'uri': _author_uri(a.get('uri'))}
                                       for a in ph.get('authorAttributions') or [] if a.get('displayName')]})
    uri = str(d.get('googleMapsUri') or '')
    loc = d.get('location') or {}
    pos = {'lat': float(loc['latitude']), 'lng': float(loc['longitude'])} if 'latitude' in loc and 'longitude' in loc else {}
    return {'name': (d.get('displayName') or {}).get('text') or '', **pos, 'kind': kind_of(d.get('primaryType')),
            'rating': d.get('rating'), 'count': d.get('userRatingCount'), 'hours': hours if len(hours) == 7 else [],
            'periods': periods_of(d.get('regularOpeningHours')), 'mapsUri': uri if uri.startswith('https://') else '', 'photos': photos}


def photo_uri(name, width):
    """写真の名前から、写真そのものの URL（認証の要らない URL）。無ければ None"""
    if not PHOTO_NAME.match(name or ''):
        return None
    d = _call('photo', f'{name}/media', query={'maxWidthPx': max(100, min(1600, int(width))), 'skipHttpRedirect': 'true'})
    uri = str((d or {}).get('photoUri') or '')
    return uri if uri.startswith('https://') else None


# ---- 候補の照合 ----

def expire(plist, now=None):
    """Google の位置を取って KEEP_DAYS を過ぎた候補を、照合の前の位置に戻す（place_id は残す）。戻した数を返す"""
    now = now or time.time()
    n = 0
    for p in plist:
        at = p.get('locatedAt')
        if at and now - at > KEEP_DAYS * 86400:
            guess = p.get('guess')
            if isinstance(guess, list) and len(guess) == 2:
                p['lat'], p['lng'] = guess
            p.pop('locatedAt', None)
            p.pop('verified', None)
            n += 1
    return n


def _pick(p, area, hits):
    """名前が合い、エリアの中にある場所のうち、いちばん近いもの。
    名前の全体が合えば 3 km 以内、括弧や「本店」を外した名前だけが合うなら 500 m 以内"""
    here = (p['lat'], p['lng'])
    variants = places.name_variants(places.jname(p), places.area_hint(area))
    best = None
    for h in hits:
        if not places.in_area(h, area):
            continue
        dm = places.dist_m(here, (h['lat'], h['lng']))
        if places.same_name(places.jname(p), h['name']):
            limit = 3000
        elif any(places.same_name(v, h['name']) for v in variants):
            limit = 500
        else:
            continue
        if dm <= limit and (best is None or dm < best[0]):
            best = (dm, h)
    return best[1] if best else None


# 照合済みの place_id（名前 → [(place_id, 緯度, 経度)]）。位置は Google のものではなく、照合の前の位置か Nominatim の位置
_known, _known_lock = {}, threading.Lock()


def learn(plist):
    """place_id のある候補を覚える。覚えた数を返す"""
    n = 0
    with _known_lock:
        for p in plist:
            pid = p.get('placeId')
            if not pid or not PLACE_ID.match(pid):
                continue
            guess = p.get('guess')
            if p.get('locatedAt'):
                if not (isinstance(guess, list) and len(guess) == 2):
                    continue
                pos = (float(guess[0]), float(guess[1]))
            else:
                pos = (float(p['lat']), float(p['lng']))
            key = places.norm_name(places.jname(p))
            got = _known.setdefault(key, [])
            if all(k[0] != pid for k in got):
                got.append((pid, pos[0], pos[1]))
                n += 1
    return n


def _known_id(p, area):
    """同じ名前で 3 km 以内に覚えた place_id があれば、それを返す"""
    with _known_lock:
        got = list(_known.get(places.norm_name(places.jname(p))) or [])
    here = (p['lat'], p['lng'])
    near = sorted((places.dist_m(here, (lat, lng)), pid) for pid, lat, lng in got
                  if places.in_area({'lat': lat, 'lng': lng}, area))
    return near[0][1] if near and near[0][0] <= 3000 else None


_missed, _missed_lock = set(), threading.Lock()


def find(p, area):
    """1 か所だけ照合して place_id を返す（無ければ None）。覚えた place_id があれば呼ばない。
    見つからなかった場所はこのサーバーが動いている間は聞き直さない。見つけた place_id は learn で覚える"""
    pid = _known_id(p, area)
    if pid:
        return pid
    key = (places.norm_name(places.jname(p)), round(p['lat'], 3), round(p['lng'], 3))
    with _missed_lock:
        if key in _missed:
            return None
    hits = search(f"{places.jname(p)} {places.area_hint(area)}", (area['lat'], area['lng']), area['radius'] * 1000 * 1.6, kind='find')
    hit = _pick(p, area, hits)
    if not hit:
        with _missed_lock:
            if len(_missed) > 5000:
                _missed.clear()
            _missed.add(key)
        return None
    learn([{**p, 'placeId': hit['id']}])
    return hit['id']


def _rank(p):
    """プランに入りやすい順（希望の候補・人気スポット・人気の高いもの）"""
    return (p.get('source') != 'wish', p.get('role') != 'famous', -places.num(p.get('popularity')))


def _set(p, pid, lat, lng, now):
    if 'guess' not in p:
        p['guess'] = [p['lat'], p['lng']]
    p['placeId'], p['lat'], p['lng'], p['locatedAt'], p['verified'] = pid, lat, lng, int(now), True
    p.pop('placeMiss', None)


def locate(plist, area):
    """place_id と位置を付ける。照合はまだの候補だけ（見つからなかった候補は placeMiss で、2 回目は呼ばない）。
    同じ名前の place_id を覚えていれば、呼ばずに place_id だけを付ける（位置は Nominatim の確かめに任せる）。
    位置を 30 日で戻した候補は、place_id で位置を取り直す。見つからない候補は Nominatim の確かめに任せる。
    照合の枠に届いたら、残りは次の機会に回す（プランに入りやすい候補から照合する）。
    → {'search': 呼んだ数, 'found': 見つかった数, 'renew': 取り直した数, 'known': 覚えていた数, 'left': 残した数}"""
    stat, lock = {'search': 0, 'found': 0, 'renew': 0, 'known': 0, 'left': 0}, threading.Lock()
    if not enabled():
        return stat
    for p in plist:
        if not p.get('placeId') and not p.get('placeMiss'):
            pid = _known_id(p, area)
            if pid:
                p['placeId'] = pid
                stat['known'] += 1
    renew = sorted((p for p in plist if p.get('placeId') and not p.get('locatedAt') and 'guess' in p), key=_rank)
    todo = sorted((p for p in plist if not p.get('placeId') and not p.get('placeMiss')), key=_rank)
    if not renew and not todo:
        learn(plist)
        return stat
    center = (area['lat'], area['lng'])
    radius = area['radius'] * 1000 * 1.6
    stop = threading.Event()

    def one_renew(p):
        if stop.is_set():
            return
        try:
            pos = location(p['placeId'])
        except Off:
            stop.set()
            return
        if pos and places.in_area({'lat': pos[0], 'lng': pos[1]}, area):
            _set(p, p['placeId'], pos[0], pos[1], time.time())
            with lock:
                stat['renew'] += 1

    def one_search(p):
        if stop.is_set():
            return
        try:
            hits = search(f"{places.jname(p)} {places.area_hint(area)}", center, radius)
        except Off:
            stop.set()
            return
        hit = _pick(p, area, hits)
        with lock:
            stat['search'] += 1
            stat['found'] += bool(hit)
        if hit:
            _set(p, hit['id'], hit['lat'], hit['lng'], time.time())
            if not_sight(p, hit):
                p['notSight'] = True
        else:
            p['placeMiss'] = True
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(one_renew, renew))
        list(ex.map(one_search, todo))
    stat['left'] = sum(1 for p in todo if not p.get('placeId') and not p.get('placeMiss'))
    learn(plist)
    return stat
