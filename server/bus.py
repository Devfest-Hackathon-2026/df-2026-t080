# 時刻表（GTFS）から、2 地点の間の乗換なしの便（バス・電車）を探す。どの時刻表を使うかは、エリアの範囲で選ぶ（bus_feeds.py）。
# 鍵（ODPT のアクセストークン）は ZT_ODPT_KEY、手元では ZT_ODPT_KEY_FILE（鍵を書いたファイル）。鍵が無ければ何もしない。
#   - GTFS は最初の問い合わせのときに取り、cache/bus/ に探しやすい小さな形にして置く（stop_times はそのまま持たない）。
#     大きな時刻表（都営バスなど）は、エリアの近くの停留所とそこを通る便だけの形にし、別のエリアのために zip だけを残す。
#   - 版はプランの日に合うもの（一覧で、その日までに始まった最後の版）。一覧が取れなければ current。
#   - 取ってから 7 日を過ぎた版は取り直す（ODPT のガイドライン 2.2.2「更新の通知から 1 週間以内に更新」）。
#   - 1 回の問い合わせには、その区間の便を 3 つまでだけ返す（基本ライセンス第 8 条 4 項。データを丸ごと取れる形にしない）。
# 鍵と、鍵の入った URL はログにも返事にも出さない。
import array, bisect, csv, datetime, io, json, math, operator, os, re, threading, time, traceback, unicodedata, urllib.error, urllib.parse, urllib.request, zipfile

import bus_feeds

FEEDS = (
    {'id': 'city', 'key': 'odpt:KyotoMunicipalTransportation/Kyoto_City_Bus_GTFS', 'kind': 'odpt', 'agency': '市バス', 'agencyEn': 'City Bus', 'name': '京都市交通局',
     'title': '京都市営バス', 'nameEn': 'Kyoto Municipal Transportation Bureau', 'titleEn': 'Kyoto City Bus',
     'license': 'odpt', 'via': 'ODPT', 'org': 'KyotoMunicipalTransportation', 'ds': 'Kyoto_City_Bus_GTFS'},
    {'id': 'kyotobus', 'key': 'odpt:KyotoBus/AllLines', 'kind': 'odpt', 'agency': '京都バス', 'agencyEn': 'Kyoto Bus', 'name': '京都バス',
     'title': '京都バス', 'nameEn': 'Kyoto Bus', 'titleEn': 'Kyoto Bus', 'license': 'odpt', 'via': 'ODPT', 'org': 'KyotoBus', 'ds': 'AllLines'},
)
FILES = 'https://api.odpt.org/api/v4/files/odpt/{org}/{ds}.zip'
UA = bus_feeds.UA
FORMAT = 6                         # 作り置きの形の版（形を変えたら上げる）
REFRESH = 7 * 86400                # 取ってからこの秒数を過ぎたら取り直す
CATALOG_TTL = 86400                # 版の一覧を聞き直す間隔
KEEP = 3                           # 事業者ごとにメモリに置く版の数
LARGE = 6 * 1024 * 1024            # zip がこれより大きい時刻表は、エリアの近くだけの形にする
MAX_ZIP = 80 * 1024 * 1024         # これより大きな zip は取らない
MEM_CAP = int(os.environ.get('ZT_BUS_MEM_MB', '300')) * 1024 * 1024   # メモリに置く表の合計の上限
RETRY_AFTER = 300                  # 取れなかった表を、もう一度取りに行くまでの秒数
REGIONS = 8                        # 大きな時刻表の 1 つの版について、メモリに置く近くだけの形の数の上限
REGION_IDLE = 3600                 # 数が上限のとき、これより長く使われていない形だけを、新しい範囲の形に入れ替える
DISK_REGIONS = 24                  # 近くだけの形の作り置き（.idx）をディスクに置く数の上限（Cloud Run のディスクはメモリの上）
DISK_CAP = 200 * 1024 * 1024       # 同じく、合計の大きさの上限
REGION_FILE = re.compile(r'-\d+\.\d{2}_\d+\.\d{2}_\d+\.\d{2}_\d+\.\d{2}\.idx$')
DOWNLOADS = 3                      # 同時に取る zip の数
BUILDS = 2                         # 同時に作る表の数
WALK_M_PER_MIN = 75                # 画面の徒歩の目安（geo.ts）と同じ
DETOUR = 1.25
NEAR_M = 800                       # 停留所を探す範囲（直線。徒歩の目安で 13 分ほど）
WINDOW = 120                       # 何分先に出る便まで探すか
LIMIT = 3
VIA_MAX = 40                       # 便の答えに入れる途中の停留所の数の上限
WAIT_CAP = 15                      # 戸口から戸口までの目安で数える待ちの上限（分。本数の少ない系統は時刻に合わせて出ると考える）
TABLE_WINDOW = 60                  # 目安を作るとき、出てから何分先の便まで見るか
TABLE_MAX = 60                     # 目安の表の点の数の上限


def walk_min(m):
    return max(1, round(m * DETOUR / WALK_M_PER_MIN))


def dist_m(lat1, lng1, lat2, lng2):
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lng1, lat2, lng2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def cost(arrive, walk_to, walk_from):
    """便の並べ方。着く時刻（歩いて着くまで）に、歩く長さを半分だけ足す（長く歩く便を後ろに回す）"""
    return arrive + walk_from + (walk_to + walk_from) * 0.5


def nfkc(s):
    return unicodedata.normalize('NFKC', s or '').strip()


def hm_text(m):
    return f'{m // 60}:{m % 60:02d}'


def ymd_int(s):
    return int(s.replace('-', '')) if s else 0


JST = datetime.timezone(datetime.timedelta(hours=9))


def ymd_of(date):
    """'YYYY-MM-DD' → 20261107。読めなければ今日（日本の日付）"""
    try:
        return ymd_int(datetime.date.fromisoformat(date).isoformat())
    except (TypeError, ValueError):
        return ymd_int(datetime.datetime.now(JST).date().isoformat())


def api_key():
    k = os.environ.get('ZT_ODPT_KEY', '').strip()
    path = os.environ.get('ZT_ODPT_KEY_FILE', '')
    if not k and path:
        try:
            with open(os.path.expanduser(path), encoding='utf-8') as f:
                k = f.read().strip()
        except OSError:
            k = ''
    return k


# ---- GTFS を探しやすい形にする ----
def _minutes(s):
    m = re.match(r'^\s*(\d{1,3}):(\d{2})', s or '')
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def route_kind(t):
    """GTFS の route_type → 0 バス・1 電車・2 船"""
    try:
        t = int(t)
    except (TypeError, ValueError):
        return 0
    if t in (3, 11) or 700 <= t < 800:
        return 0
    if t in (4, 1200) or 1000 <= t < 1100:
        return 2
    return 1


def _route_label(feed, r, agency=''):
    """系統の名前（事業者の名前が頭に付いていれば外す）。電車は線の名前（G → 銀座線）"""
    short = nfkc(r.get('route_short_name'))
    long_ = nfkc(r.get('route_long_name'))
    for p in sorted({feed.get('agency') or '', agency} - {''}, key=len, reverse=True):
        if short.startswith(p) and len(short) > len(p):
            short = short[len(p):].strip()
    if route_kind(r.get('route_type')) == 1 and long_ and len(long_) <= 14 and (not short or re.fullmatch(r'[A-Za-z]{1,2}', short)):
        return long_
    if short:
        return short
    m = re.search(r'([0-9・特快速直行]+)系統', nfkc(r.get('jp_parent_route_id')))
    return m.group(1) if m else long_[:20]


def _color(v):
    """routes.txt の色（6 桁の 16 進）。書いてあるとおりに返す（ODPT のガイドライン 4。加工しない）。無い・形が違えば None"""
    v = (v or '').strip()
    return v if re.fullmatch(r'[0-9A-Fa-f]{6}', v) else None


def _translations(rows):
    """translations.txt の英語 → 引く関数 en(表, 列, record_id, 日本語の値)。無ければ ''。
    GTFS の形（table_name・field_name・language・translation・record_id・field_value）と、
    GTFS-JP の古い形（trans_id・lang・translation。trans_id が日本語の値）の両方を読む"""
    by_id, by_value, old = {}, {}, {}
    for r in rows:
        if (r.get('language') or r.get('lang') or '').strip().lower() != 'en':
            continue
        text = nfkc(r.get('translation'))
        if not text:
            continue
        if 'trans_id' in r:
            old[nfkc(r.get('trans_id'))] = text
            continue
        k = (r.get('table_name') or '', r.get('field_name') or '')
        if r.get('record_id'):
            by_id[(*k, r['record_id'], r.get('record_sub_id') or '')] = text
        if r.get('field_value'):
            by_value[(*k, nfkc(r['field_value']))] = text

    def en(table, field, rid='', value=''):
        v = nfkc(value)
        return by_id.get((table, field, rid, '')) or by_value.get((table, field, v)) or old.get(v) or ''
    return en


def _headsign_en(s):
    """英語の行き先（経由地の「via ……」・括弧の中・閉じていない括弧から後ろ・「・」で並べた経由地を外す）"""
    t = re.sub(r'\s+via\s.*$', '', nfkc(s), flags=re.I)
    t = re.sub(r'\s*\([^()]*\)', '', t)
    t = re.split(r'[()]', t)[0]
    t = re.split(r'\s*[・･]\s*', t)[0].strip()
    return (t or nfkc(s))[:60]


def _route_en(text, agency_en):
    """英語の系統の名前から、事業者の英語の名前（City Bus など）を外す"""
    t = nfkc(text)
    for a in sorted({agency_en, 'City Bus', 'Bus'} - {''}, key=len, reverse=True):
        t = re.sub(rf'(^|\s){re.escape(a)}(\s|$)', ' ', t, flags=re.I).strip()
    return t[:30]


def _route_latin(text):
    """路線名から日本語を外し、番号と英字だけにする（五条通5 → 5、34・35 → 34/35）。残らなければ空"""
    return '/'.join(re.findall(r'[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*', nfkc(text)))[:30]


def in_lang(trip, lang):
    """便の名前を画面の言語にする。英語の名前（en）があれば差し替える。en は画面に渡さない。
    英語の路線名が無いか、英語の名前にも日本語が残るときは、路線名の番号と英字だけを出す（それも無ければ元のまま）"""
    e = trip.pop('en', None) or {}
    if isinstance(trip.get('via'), list):
        via = []
        for v in trip['via']:
            if isinstance(v, dict):
                v = dict(v)
                name_en = v.pop('en', '')
                if lang == 'en' and name_en:
                    v['name'] = name_en
                via.append(v)
        trip['via'] = via
    if lang != 'en':
        return trip
    for k in ('agency', 'route', 'headsign'):
        if e.get(k):
            trip[k] = e[k]
    for k in ('board', 'alight'):
        if e.get(k) and isinstance(trip.get(k), dict):
            trip[k] = {**trip[k], 'name': e[k]}
    if trip.get('route') and re.search(r'[^\x00-\x7f]', nfkc(trip['route'])):
        trip['route'] = _route_latin(trip['route']) or trip['route']
    return trip


def _headsign(s):
    """行き先（括弧の中の経由地と、終わりの「行」「行き」を外す）"""
    s = nfkc(s)
    t = re.sub(r'\s*[（(][^）)]*[）)]\s*', ' ', s)
    t = re.sub(r'\s*[（(].*$', '', t)
    t = re.sub(r'\s*行き?$', '', t.strip()).strip()
    return (t or s)[:40]


def build(zip_path, feed, meta, region=None):
    """GTFS の zip から、便を探すのに要る分だけの表を作る（文字の表は JSON、数の並びは array）。
    region（南, 西, 北, 東）を渡すと、その範囲（と 1 km の外側）の停留所と、そこに停まる便だけにする"""
    t0 = time.time()
    keep = bus_feeds.box_of([region[:2], region[2:]], 1000) if region else None
    zf = zipfile.ZipFile(zip_path)
    names = set(zf.namelist())

    def rows(name):
        if name not in names:
            return
        with zf.open(name) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig', newline=''))

    def table(name, *cols):
        """大きな表は辞書を作らずに読む（無い列は空の文字）"""
        if name not in names:
            return
        with zf.open(name) as f:
            rd = csv.reader(io.TextIOWrapper(f, encoding='utf-8-sig', newline=''))
            head_row = next(rd, [])
            hdr = {h.strip(): i for i, h in enumerate(head_row)}
            width = len(head_row)
            pick = operator.itemgetter(*(hdr.get(c, width) for c in cols))
            for row in rd:
                n = len(row)
                if n <= width:
                    row.extend([''] * (width + 1 - n))
                yield pick(row)

    info = next(rows('feed_info.txt'), None) or {}
    en = _translations(rows('translations.txt'))
    stop_ix, s_name, s_plat, s_lat, s_lng = {}, [], [], array.array('d'), array.array('d')
    s_name_en = []
    for s in rows('stops.txt'):
        if s.get('location_type') not in ('', '0', None):
            continue
        try:
            lat, lng = float(s['stop_lat']), float(s['stop_lon'])
        except (KeyError, ValueError):
            continue
        if keep and not (keep[0] <= lat <= keep[2] and keep[1] <= lng <= keep[3]):
            continue
        stop_ix[s['stop_id']] = len(s_name)
        s_name.append(nfkc(s.get('stop_name'))[:30])
        s_name_en.append(en('stops', 'stop_name', s['stop_id'], s.get('stop_name'))[:40])
        s_plat.append(nfkc(s.get('platform_code'))[:8])
        s_lat.append(lat)
        s_lng.append(lng)

    agency_rows = list(rows('agency.txt'))
    agencies = {a.get('agency_id') or '': nfkc(a.get('agency_name')) for a in agency_rows}
    agencies_en = {a.get('agency_id') or '': en('agency', 'agency_name', a.get('agency_id') or '', a.get('agency_name')) for a in agency_rows}
    many = len(set(agencies.values())) > 1
    a_names, a_names_en, a_ix = [], [], {}
    route_ix, r_label, r_agency, r_kind, r_color, r_text = {}, [], array.array('H'), array.array('B'), [], []
    r_label_en = []
    for r in rows('routes.txt'):
        aid = r.get('agency_id') or ''
        ag = bus_feeds.short_name(agencies.get(aid, '')) if many else (feed.get('agency') or '')
        ag = ag or feed.get('agency') or ''
        ag_en = agencies_en.get(aid, '') if many else (feed.get('agencyEn') or agencies_en.get(aid, ''))
        if ag not in a_ix:
            a_ix[ag] = len(a_names)
            a_names.append(ag)
            a_names_en.append(ag_en[:30])
        route_ix[r['route_id']] = len(r_label)
        label = _route_label(feed, r, ag)[:20]
        r_label.append(label)
        long_en = en('routes', 'route_long_name', r['route_id'], r.get('route_long_name'))
        short_en = en('routes', 'route_short_name', r['route_id'], r.get('route_short_name'))
        use_long = label == nfkc(r.get('route_long_name')) and long_en
        r_label_en.append(_route_en(long_en if use_long else short_en, ag_en) if (use_long or short_en) else '')
        r_agency.append(a_ix[ag])
        r_kind.append(route_kind(r.get('route_type')))
        r_color.append(_color(r.get('route_color')))
        r_text.append(_color(r.get('route_text_color')))

    heads, head_ix, head_raw, heads_en = [], {}, {}, []

    def head(raw):
        i = head_raw.get(raw)
        if i is None:
            s = _headsign(raw)
            i = head_ix.get(s)
            if i is None:
                i = head_ix[s] = len(heads)
                heads.append(s)
                h_en = en('trips', 'trip_headsign', '', raw) or en('stop_times', 'stop_headsign', '', raw)
                heads_en.append(_headsign_en(h_en) if h_en else '')
            head_raw[raw] = i
        return i

    svc_ix, services = {}, []

    def svc(sid):
        i = svc_ix.get(sid)
        if i is None:
            i = svc_ix[sid] = len(services)
            services.append(sid)
        return i

    calendar = []
    days = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
    for c in rows('calendar.txt'):
        mask = sum(1 << i for i, d in enumerate(days) if c.get(d) == '1')
        calendar.append([svc(c['service_id']), mask, ymd_int(c.get('start_date')), ymd_int(c.get('end_date'))])
    exceptions = {}
    for c in rows('calendar_dates.txt'):
        exceptions.setdefault(str(ymd_int(c.get('date'))), []).append([svc(c['service_id']), 1 if c.get('exception_type') == '1' else 2])

    # 形（shapes.txt）。無い事業者もある（京都バスは空）
    shape_pts = {}
    for sid, seq, lat, lng in table('shapes.txt', 'shape_id', 'shape_pt_sequence', 'shape_pt_lat', 'shape_pt_lon'):
        try:
            la, lo = float(lat), float(lng)
            if keep and not (keep[0] <= la <= keep[2] and keep[1] <= lo <= keep[3]):
                continue
            shape_pts.setdefault(sid, []).append((int(seq), la, lo))
        except ValueError:
            continue
    shape_ix, sh_off, sh_lat, sh_lng = {}, array.array('I', [0]), array.array('d'), array.array('d')
    for sid, pts in shape_pts.items():
        pts.sort()
        shape_ix[sid] = len(sh_off) - 1
        for _, lat, lng in pts:
            sh_lat.append(lat)
            sh_lng.append(lng)
        sh_off.append(len(sh_lat))
    del shape_pts

    trip_ix, t_route, t_svc, t_shape, t_head = {}, array.array('I'), array.array('I'), array.array('i'), array.array('I')
    for rid, sid, tid, shid, hs in table('trips.txt', 'route_id', 'service_id', 'trip_id', 'shape_id', 'trip_headsign'):
        ri = route_ix.get(rid)
        if ri is None:
            continue
        trip_ix[tid] = len(t_route)
        t_route.append(ri)
        t_svc.append(svc(sid))
        t_shape.append(shape_ix.get(shid, -1))
        t_head.append(head(hs))

    # 停車（stop_times.txt）は便と順番で並べ直す。並びの手がかりは 1 つの整数にして、表を小さく保つ
    c_trip, c_stop, c_arr, c_dep, c_flag, c_head = (array.array('I'), array.array('H' if len(s_name) < 65536 else 'I'),
                                                    array.array('H'), array.array('H'), array.array('B'), array.array('I'))
    keys, last, ordered, clock = array.array('Q'), -1, True, {}
    for tid, at, dt, sid, seq, pu, do, hs in table('stop_times.txt', 'trip_id', 'arrival_time', 'departure_time', 'stop_id',
                                                     'stop_sequence', 'pickup_type', 'drop_off_type', 'stop_headsign'):
        si = stop_ix.get(sid)
        if si is None:
            continue
        ti = trip_ix.get(tid)
        if ti is None:
            continue
        arr = clock.get(at, -1)
        if arr == -1:
            arr = clock[at] = _minutes(at)
        dep = arr if dt == at else clock.get(dt, -1)
        if dep == -1:
            dep = clock[dt] = _minutes(dt)
        if arr is None and dep is None:
            continue
        arr = dep if arr is None else arr
        dep = arr if dep is None else dep
        k = (ti << 24) + (min(int(seq), 0xFFFFFF) if seq.isdigit() else 0)
        if k < last:
            ordered = False
        last = k
        keys.append(k)
        c_trip.append(ti)
        c_stop.append(si)
        c_arr.append(arr)
        c_dep.append(dep)
        c_flag.append((1 if pu == '1' else 0) | (2 if do == '1' else 0))
        c_head.append((head_raw.get(hs) if hs in head_raw else head(hs)) if hs else 0xFFFFFFFF)
    n = len(c_trip)
    order = None if ordered else sorted(range(n), key=keys.__getitem__)
    del keys

    def reorder(a):
        return a if order is None else array.array(a.typecode, (a[i] for i in order))
    c_trip, c_stop, c_arr, c_dep, c_flag, c_head = map(reorder, (c_trip, c_stop, c_arr, c_dep, c_flag, c_head))
    del order
    t_off = array.array('I', [0] * (len(t_route) + 1))
    for ti in c_trip:
        t_off[ti + 1] += 1
    for i in range(len(t_route)):
        t_off[i + 1] += t_off[i]
    del c_trip

    # 停留所ごとの発車（出る時刻の順）
    by_stop = sorted((r for r in range(n) if not c_flag[r] & 1), key=lambda r: c_stop[r] * 65536 + c_dep[r])
    s_rows = array.array('I', by_stop)
    del by_stop
    s_dep = array.array('H', (c_dep[r] for r in s_rows))
    s_off = array.array('I', [0] * (len(s_name) + 1))
    for r in s_rows:
        s_off[c_stop[r] + 1] += 1
    for i in range(len(s_name)):
        s_off[i + 1] += s_off[i]

    bbox = [round(min(s_lat), 4), round(min(s_lng), 4), round(max(s_lat), 4), round(max(s_lng), 4)] if len(s_lat) else None
    meta = {**meta, 'format': FORMAT, 'feed': feed['id'], 'agency': feed.get('agency') or '', 'bbox': bbox,
            'region': list(region) if region else None, 'credit': bus_feeds.credit(feed),
            'feedVersion': nfkc(info.get('feed_version'))[:60], 'feedStart': info.get('feed_start_date') or '',
            'feedEnd': info.get('feed_end_date') or '', 'built': round(time.time() - t0, 2)}
    strings = {'stopName': s_name, 'stopPlat': s_plat, 'route': r_label, 'routeColor': r_color, 'routeText': r_text,
               'agencies': a_names, 'head': heads, 'services': services,
               'en': {'stop': s_name_en, 'route': r_label_en, 'head': heads_en, 'agency': a_names_en},
               'calendar': calendar, 'exceptions': exceptions}
    arrays = {'s_lat': s_lat, 's_lng': s_lng, 'sh_off': sh_off, 'sh_lat': sh_lat, 'sh_lng': sh_lng, 'r_agency': r_agency, 'r_kind': r_kind,
              't_route': t_route, 't_svc': t_svc, 't_shape': t_shape, 't_head': t_head, 't_off': t_off,
              'r_stop': c_stop, 'r_arr': c_arr, 'r_dep': c_dep, 'r_flag': c_flag, 'r_head': c_head,
              's_off': s_off, 's_rows': s_rows, 's_dep': s_dep}
    return Index(meta, strings, arrays)


class Index:
    def __init__(self, meta, strings, arrays):
        self.meta, self.s, self.a = meta, strings, arrays
        for k, v in arrays.items():
            setattr(self, k, v)
        self.stop_name, self.stop_plat = strings['stopName'], strings['stopPlat']
        self.route, self.head = strings['route'], strings['head']
        self.agencies = strings.get('agencies') or [meta.get('agency') or '']
        self.route_color = strings.get('routeColor') or [None] * len(self.route)
        self.route_text = strings.get('routeText') or [None] * len(self.route)
        self.en = strings.get('en') or {}
        self._days = {}

    # 作り置き: 1 行目に JSON（文字の表と数の並びの型・長さ）、続けて数の並びをそのまま
    def save(self, path):
        hdr = {'meta': self.meta, 'strings': self.s, 'arrays': [[k, v.typecode, len(v)] for k, v in self.a.items()]}
        tmp = f'{path}.{threading.get_ident()}.tmp'
        with open(tmp, 'wb') as f:
            f.write(json.dumps(hdr, ensure_ascii=False).encode() + b'\n')
            for v in self.a.values():
                v.tofile(f)
        os.replace(tmp, path)

    @classmethod
    def load(cls, path):
        with open(path, 'rb') as f:
            hdr = json.loads(f.readline())
            arrays = {}
            for k, tc, n in hdr['arrays']:
                a = array.array(tc)
                a.fromfile(f, n)
                arrays[k] = a
        return cls(hdr['meta'], hdr['strings'], arrays)

    def nbytes(self):
        return sum(v.itemsize * len(v) for v in self.a.values())

    def services_on(self, ymd):
        """その日に走る運行の番号（calendar と calendar_dates。祝日は calendar_dates に任せる）"""
        hit = self._days.get(ymd)
        if hit is not None:
            return hit
        d = datetime.date(ymd // 10000, ymd // 100 % 100, ymd % 100)
        bit = 1 << d.weekday()
        on = {si for si, mask, a, b in self.s['calendar'] if mask & bit and a <= ymd <= b}
        for si, kind in self.s['exceptions'].get(str(ymd), []):
            (on.add if kind == 1 else on.discard)(si)
        if len(self._days) > 64:
            self._days.clear()
        self._days[ymd] = on
        return on

    def near(self, lat, lng, radius=NEAR_M):
        k = math.cos(math.radians(lat))
        dlat = radius / 111320
        dlng = dlat / max(0.1, k)
        out = []
        for i in range(len(self.s_lat)):
            la, lo = self.s_lat[i], self.s_lng[i]
            if abs(la - lat) > dlat or abs(lo - lng) > dlng:
                continue
            m = dist_m(lat, lng, la, lo)
            if m <= radius:
                out.append((i, walk_min(m)))
        return out

    def search(self, a, b, ymd, after, limit=LIMIT):
        """a・b: (lat, lng)。after: 分。a の近くの停留所で乗り、b の近くで降りる便を、着く時刻（歩く長さを少し足す）の早い順に"""
        on = self.services_on(ymd)
        if not on:
            return []
        origin = self.near(*a)
        dest = dict(self.near(*b))
        if not origin or not dest:
            return []
        best = {}
        for s, wa in origin:
            lo, hi = self.s_off[s], self.s_off[s + 1]
            i = bisect.bisect_left(self.s_dep, after + wa, lo, hi)
            j = bisect.bisect_right(self.s_dep, after + wa + WINDOW, lo, hi)
            for k in range(i, j):
                r = self.s_rows[k]
                t = bisect.bisect_right(self.t_off, r) - 1
                if self.t_svc[t] not in on:
                    continue
                for r2 in range(r + 1, self.t_off[t + 1]):
                    s2 = self.r_stop[r2]
                    if s2 == s:
                        break                     # 同じ停留所に戻ってくる循環の便は、そこで止める
                    wb = dest.get(s2)
                    if wb is None or self.r_flag[r2] & 2:
                        continue
                    key = (cost(self.r_arr[r2], wa, wb), wa + wb, -self.r_dep[r])
                    cur = best.get(t)
                    if cur is None or key < cur[0]:
                        best[t] = (key, r, r2, wa, wb)
        seen, out = set(), []
        for key, r, r2, wa, wb in sorted(best.values()):
            t = bisect.bisect_right(self.t_off, r) - 1
            sig = (self.route[self.t_route[t]], self.r_dep[r], self.r_arr[r2], self.r_stop[r], self.r_stop[r2])
            if sig in seen:
                continue
            seen.add(sig)
            out.append(self.describe(t, r, r2, wa, wb))
            if len(out) >= limit:
                break
        return out

    def scan(self, origin, t, on, window=TABLE_WINDOW, cap=WAIT_CAP):
        """t に出たとして、乗換なしで行ける停留所ごとの「歩く＋待つ（cap まで）＋乗る」の最小（分）"""
        best = {}
        for s, wa in origin:
            lo, hi = self.s_off[s], self.s_off[s + 1]
            i = bisect.bisect_left(self.s_dep, t + wa, lo, hi)
            j = bisect.bisect_right(self.s_dep, t + wa + window, lo, hi)
            for k in range(i, j):
                r = self.s_rows[k]
                tr = bisect.bisect_right(self.t_off, r) - 1
                if self.t_svc[tr] not in on:
                    continue
                dep = self.r_dep[r]
                base = wa + min(dep - t - wa, cap) - dep
                for r2 in range(r + 1, self.t_off[tr + 1]):
                    s2 = self.r_stop[r2]
                    if s2 == s:
                        break
                    if self.r_flag[r2] & 2:
                        continue
                    v = base + self.r_arr[r2]
                    if v < best.get(s2, 1e9):
                        best[s2] = v
        return best

    def stop_pt(self, s):
        return {'name': self.stop_name[s], 'platform': self.stop_plat[s], 'lat': round(self.s_lat[s], 6), 'lng': round(self.s_lng[s], 6)}

    def describe(self, t, r, r2, wa, wb):
        h = self.r_head[r]
        head = self.head[h] if h != 0xFFFFFFFF else self.head[self.t_head[t]]
        board = {**self.stop_pt(self.r_stop[r]), 'time': hm_text(self.r_dep[r])}
        alight = {**self.stop_pt(self.r_stop[r2]), 'time': hm_text(self.r_arr[r2])}
        line, exact = self.ride_line(t, r, r2)
        ri = self.t_route[t]
        en = self.english(ri, h if h != 0xFFFFFFFF else self.t_head[t], self.r_stop[r], self.r_stop[r2])
        mid = self.middle(r, r2)
        return {**({'en': en} if en else {}), 'agency': self.agencies[self.r_agency[ri]], 'route': self.route[ri], 'mode': 'train' if self.r_kind[ri] == 1 else 'bus',
                'color': self.route_color[ri], 'textColor': self.route_text[ri], 'headsign': head, 'board': board, 'alight': alight, 'walkTo': wa, 'walkFrom': wb,
                'stops': len(mid) + 1, 'via': [self.via_stop(x) for x in mid[:VIA_MAX]],
                'line': line, 'shape': exact, '_pattern': (self.meta['feed'], tuple(self.r_stop[x] for x in range(r, r2 + 1)))}

    def middle(self, r, r2):
        """乗る行と降りる行の間の、止まる停留所の行（乗ることも降りることもできない、通るだけの行は除く）"""
        return [x for x in range(r + 1, r2) if self.r_flag[x] & 3 != 3]

    def via_stop(self, x):
        """途中の停留所の名前と時刻（英語の名前があれば en に）"""
        s = self.r_stop[x]
        names = self.en.get('stop') or []
        en = names[s] if s < len(names) else ''
        return {'name': self.stop_name[s], 'time': hm_text(self.r_arr[x]), **({'en': en} if en else {})}

    def english(self, ri, h, s1, s2):
        """便の英語の名前（時刻表に英語があるものだけ。無ければ None）"""
        e = self.en
        if not e:
            return None
        pick = lambda k, i: (e.get(k) or [])[i] if i < len(e.get(k) or []) else ''
        out = {'agency': pick('agency', self.r_agency[ri]), 'route': pick('route', ri), 'headsign': pick('head', h),
               'board': pick('stop', s1), 'alight': pick('stop', s2)}
        return {k: v for k, v in out.items() if v} or None

    def ride_line(self, t, r, r2):
        """乗る区間の線（[lng, lat] の並び）。形があれば乗る所から降りる所までで切り、無ければ停留所を順につなぐ"""
        stops = [(self.s_lat[self.r_stop[x]], self.s_lng[self.r_stop[x]]) for x in range(r, r2 + 1)]
        sh = self.t_shape[t]
        if sh >= 0:
            cut = self.cut_shape(sh, t, r, r2)
            if cut:
                return thin([[lo, la] for la, lo in cut]), True
        return [[round(lo, 5), round(la, 5)] for la, lo in stops], False

    def cut_shape(self, sh, t, r, r2):
        """便の始めから停留所を順に形の上へ載せ、乗る停留所と降りる停留所の間の形を返す（遠すぎれば None）"""
        lo, hi = self.sh_off[sh], self.sh_off[sh + 1]
        if hi - lo < 2:
            return None
        j = lo
        jb = ja = None
        for x in range(self.t_off[t], r2 + 1):
            s = self.r_stop[x]
            la, ln = self.s_lat[s], self.s_lng[s]
            best, bi = float('inf'), j
            for q in range(j, hi):
                d = dist_m(la, ln, self.sh_lat[q], self.sh_lng[q])
                if d < best:
                    best, bi = d, q
                elif best < 80 and d > best + 300:
                    break
            if x == r:
                jb = (bi, best)
            if x == r2:
                ja = (bi, best)
            j = bi
        if not jb or not ja or jb[1] > 150 or ja[1] > 150 or ja[0] <= jb[0]:
            return None
        sb, sa = self.r_stop[r], self.r_stop[r2]
        pts = [(self.s_lat[sb], self.s_lng[sb])]
        pts += [(self.sh_lat[q], self.sh_lng[q]) for q in range(jb[0], ja[0] + 1)]
        pts.append((self.s_lat[sa], self.s_lng[sa]))
        return pts


def thin(line, most=300):
    step = max(1, math.ceil(len(line) / most))
    out = [[round(x, 5), round(y, 5)] for x, y in line[::step]]
    last = [round(line[-1][0], 5), round(line[-1][1], 5)]
    if out[-1] != last:
        out.append(last)
    return out


# ---- 取ってくる係 ----
class Fixed:
    """決まった時刻表だけを使う一覧（試験で、取ってくる係を差し替えたとき）"""

    def __init__(self, feeds):
        self.list = list(feeds)

    def feeds(self, box):
        return list(self.list)

    def versions(self, feed):
        return []


def region_for(box):
    """大きな時刻表の、近くだけの形にする範囲（box を 5 km ほど広げて 0.1 度の升目に合わせる）"""
    s, w, n, e = bus_feeds.clip(box)
    return bus_feeds.snap((s - 0.05, w - 0.05, n + 0.05, e + 0.05))


class Store:
    """版の一覧・取ってきた版・作り置きを持つ。get(feed, ymd, box=範囲) でその日に使う版の Index を返す。
    fetch か catalog を差し替えたとき（試験）は、FEEDS だけを使う"""

    def __init__(self, cache_dir, key_fn=api_key, fetch=None, catalog=None, now=time.time, directory=None):
        self.dir = cache_dir
        self.key_fn, self.now = key_fn, now
        self.fetch_zip = fetch or self._fetch_zip
        self.fetch_catalog = catalog or self._fetch_catalog
        if directory is None:
            directory = bus_feeds.Directory(cache_dir, now=now) if fetch is None and catalog is None else Fixed(FEEDS)
        self.directory = directory
        self.lock = threading.Lock()
        self.loaded = {}          # (feed, res, 範囲) → Index
        self.used = {}            # (feed, res, 範囲) → 最後に使った時刻
        self.catalogs = {}        # feed → (取った時刻, [版])
        self.busy = {}            # (feed, res, 範囲) → threading.Event（取っている最中）
        self.failed = {}          # (feed, res, 範囲) → 失敗した時刻
        self.zip_locks = {}       # (feed, res) → threading.Lock（同じ zip を 2 回取らない）
        self.dl = threading.Semaphore(DOWNLOADS)
        self.mk = threading.Semaphore(BUILDS)
        os.makedirs(self.dir, exist_ok=True)

    def enabled(self):
        return bool(self.key_fn())

    def feeds_for(self, box):
        """範囲に関わる時刻表（鍵が無ければ空）"""
        if not self.enabled():
            return []
        try:
            return [f for f in self.directory.feeds(box) if f.get('kind') != 'data' or not f.get('needKey') or self.enabled()]
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return []

    def _fetch_catalog(self, feed):
        return self.directory.versions(feed)

    def catalog(self, feed):
        with self.lock:
            hit = self.catalogs.get(feed['id'])
        if hit and self.now() - hit[0] < CATALOG_TTL:
            return hit[1]
        try:
            lst = self.fetch_catalog(feed)
        except Exception as e:  # noqa: BLE001
            print(f"[bus] {feed['id']}: 版の一覧を取れませんでした（{type(e).__name__}）", flush=True)
            lst = None
        if not lst:
            lst = hit[1] if hit else []
            at = self.now() - CATALOG_TTL + 600       # 10 分後にもう一度聞く
        else:
            at = self.now()
        with self.lock:
            self.catalogs[feed['id']] = (at, lst)
        return lst

    def pick(self, feed, ymd):
        """その日に使う版（その日までに始まった最後の版。どれも先なら最初の版。一覧が無ければ current）"""
        lst = self.catalog(feed)
        if not lst:
            return 'current'
        def start(x):
            v = str(x.get('start') or x.get('res') or '')
            return int(v) if v.isascii() and v.isdigit() else 0
        ok = [x for x in lst if start(x) <= ymd]
        if not ok:
            return min(lst, key=start)['res']
        return max(ok, key=lambda x: (start(x), x.get('uploaded') or ''))['res']

    def label(self, feed, res, idx):
        """出典に出す版の日付（YYYY-MM-DD）。決まった URL の物は、時刻表の始まりの日"""
        d = res if re.fullmatch(r'\d{8}', res or '') else ''
        if not d:
            d = next((x.get('start') or '' for x in (self.catalogs.get(feed['id']) or (0, []))[1] if x.get('res') == res), '')
        if not d and feed.get('kind') == 'data':
            d = re.sub(r'\D', '', idx.meta.get('feedStart') or '')
        return f'{d[:4]}-{d[4:6]}-{d[6:8]}' if re.fullmatch(r'\d{8}', d) else ''

    def url_of(self, feed, res, key):
        kind = feed.get('kind', 'odpt')
        if kind == 'gtfsjp':
            return bus_feeds.GTFSJP_ZIP.format(org=urllib.parse.quote(feed['org']), feed=urllib.parse.quote(feed['feed']), uid=urllib.parse.quote(res))
        if kind == 'data':
            return feed['url'] + ('?' + urllib.parse.urlencode({'acl:consumerKey': key}, safe=':') if feed.get('needKey') else '')
        return FILES.format(org=feed['org'], ds=feed['ds']) + '?' + urllib.parse.urlencode({'date': res, 'acl:consumerKey': key}, safe=':')

    def _fetch_zip(self, feed, res, dest):
        key = self.key_fn()
        needs = feed.get('kind', 'odpt') == 'odpt' or (feed.get('kind') == 'data' and feed.get('needKey'))
        if needs and not key:
            raise RuntimeError('off')
        url = self.url_of(feed, res, key)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120) as r, open(dest, 'wb') as f:
                got = 0
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > MAX_ZIP:
                        raise RuntimeError('large')
                    f.write(chunk)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'http {e.code}') from None
        except RuntimeError as e:
            raise RuntimeError(str(e)[:20]) from None
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(type(e).__name__) from None

    def large(self, feed):
        return (feed.get('bytes') or 0) > LARGE

    def _path(self, feed, res, region=None):
        tail = '' if not region else '-' + '_'.join(f'{x:.2f}' for x in region)
        return os.path.join(self.dir, f"{feed['id']}-{re.sub(r'[^A-Za-z0-9-]', '', res)[:40]}{tail}.idx")

    def _obtain(self, feed, res, region):
        """作り置きが新しければそれを、無いか古ければ取って作る。近くだけの形にする時刻表は zip も残す"""
        path = self._path(feed, res, region)
        try:
            idx = Index.load(path)
            if idx.meta.get('format') == FORMAT and self.now() - idx.meta.get('fetched', 0) <= REFRESH:
                if region is not None:
                    os.utime(path)
                return idx
        except (OSError, ValueError, KeyError, EOFError):
            pass
        zk = (feed['id'], res)
        with self.lock:
            zl = self.zip_locks.setdefault(zk, threading.Lock())
        t0 = time.time()
        with zl:
            keep = region is not None
            zpath = os.path.join(self.dir, f"{feed['id']}-{re.sub(r'[^A-Za-z0-9-]', '', res)[:40]}.zip") if keep else f'{path}.{threading.get_ident()}.zip'
            fetched = None
            if keep:
                try:
                    with open(zpath + '.at', encoding='utf-8') as f:
                        at = float(f.read())
                    if os.path.exists(zpath) and self.now() - at <= REFRESH:
                        fetched = at
                except (OSError, ValueError):
                    pass
            try:
                if fetched is None:
                    with self.dl:
                        self.fetch_zip(feed, res, zpath + '.part')
                    os.replace(zpath + '.part', zpath)
                    fetched = self.now()
                    if keep:
                        with open(zpath + '.at', 'w', encoding='utf-8') as f:
                            f.write(str(fetched))
                with self.mk:
                    idx = build(zpath, feed, {'res': res, 'fetched': fetched}, region)
            finally:
                for x in ((zpath + '.part',) if keep else (zpath, zpath + '.part')):
                    try:
                        os.remove(x)
                    except OSError:
                        pass
        try:
            idx.save(path)
        except OSError:
            traceback.print_exc()
        if region is not None:
            self._prune_files(path)
        print(f"[bus] {feed['id']} {res[:12]}{' 近く' if region else ''}: {len(idx.t_route)} 便・{len(idx.r_stop)} 停車・"
              f"{idx.nbytes() // 1024} KB（取得と作成 {time.time() - t0:.1f} 秒）", flush=True)
        return idx

    def _prune_files(self, keep):
        """近くだけの形の作り置きを、最近使った順に DISK_REGIONS 個・合計 DISK_CAP までにする（keep は消さない）"""
        try:
            names = [n for n in os.listdir(self.dir) if REGION_FILE.search(n)]
        except OSError:
            return
        files = []
        for n in names:
            p = os.path.join(self.dir, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            files.append((p == keep, st.st_mtime, st.st_size, p))
        count, total = 0, 0
        for first, _, size, p in sorted(files, reverse=True):
            if not first and (count + 1 > DISK_REGIONS or total + size > DISK_CAP):
                try:
                    os.remove(p)
                except OSError:
                    pass
                continue
            count, total = count + 1, total + size

    def _evict(self, k):
        """メモリに置く表を、事業者ごとに KEEP 版まで・全体で MEM_CAP までにする（古く使った物から外す）。
        版は、その版の範囲のどれかを最後に使った時刻で比べ、範囲の数によらず 1 版を 1 つと数える"""
        last = {}
        for kk in self.loaded:
            if kk[0] == k[0] and kk[1] != k[1]:
                last[kk[1]] = max(last.get(kk[1], 0), self.used.get(kk, 0))
        olds = sorted(last, key=last.get)[:max(0, len(last) + 1 - KEEP)]
        drop = {kk for kk in self.loaded if kk[0] == k[0] and kk[1] in olds}
        total = sum(i.nbytes() for kk, i in self.loaded.items() if kk not in drop)
        for kk in sorted((kk for kk in self.loaded if kk not in drop and kk != k), key=lambda kk: self.used.get(kk, 0)):
            if total <= MEM_CAP:
                break
            drop.add(kk)
            total -= self.loaded[kk].nbytes()
        for kk in drop:
            self.loaded.pop(kk, None)
        self._tidy()

    def _tidy(self):
        """メモリにも、作っている最中にも無い表の印と、取り直してよくなった失敗の印を消す（lock の中で呼ぶ）"""
        for kk in [kk for kk in self.used if kk not in self.loaded and kk not in self.busy]:
            del self.used[kk]
        for kk in [kk for kk, at in self.failed.items() if self.now() - at >= RETRY_AFTER]:
            del self.failed[kk]

    def _load(self, feed, res, k):
        try:
            idx = self._obtain(feed, res, k[2])
            idx.meta['label'] = self.label(feed, res, idx)
            idx.meta['credit'] = bus_feeds.credit(feed)
            idx.meta['agency'] = feed.get('agency') or idx.meta.get('agency')
            with self.lock:
                self.loaded[k] = idx
                self.failed.pop(k, None)
                self._evict(k)
        except Exception as e:  # noqa: BLE001
            print(f"[bus] {feed['id']} {res[:12]}: 取れませんでした（{e}）", flush=True)
            with self.lock:
                self.failed[k] = self.now()
        finally:
            with self.lock:
                ev = self.busy.pop(k, None)
                self._tidy()
            if ev:
                ev.set()

    def _key(self, feed, res, box):
        """使う表の印（lock の中で呼ぶ）。大きな時刻表は、box を含む範囲の物（あれば、作っている途中の物も）。
        無ければ新しい範囲の物。ただし、その版の形が REGIONS 個あるときは、REGION_IDLE 秒より長く使われていない物を
        外して入れ替え、そういう物が無ければ、新しく作らずにいちばん近い範囲の物を使う"""
        if box is None or not self.large(feed):
            return (feed['id'], res, None)
        mine = []
        for pool in (self.loaded, self.busy):
            for kk in pool:
                if kk[0] == feed['id'] and kk[1] == res and kk[2] and kk not in mine:
                    if bus_feeds.contains(kk[2], box):
                        return kk
                    mine.append(kk)
        if len(mine) >= REGIONS:
            idle = [kk for kk in mine if kk not in self.busy and self.now() - self.used.get(kk, 0) >= REGION_IDLE]
            if not idle:
                cy, cx = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                return min(mine, key=lambda kk: ((kk[2][0] + kk[2][2]) / 2 - cy) ** 2 + ((kk[2][1] + kk[2][3]) / 2 - cx) ** 2)
            old = min(idle, key=lambda kk: self.used.get(kk, 0))
            self.loaded.pop(old, None)
            self.used.pop(old, None)
        return (feed['id'], res, region_for(box))

    def get(self, feed, ymd, wait=25.0, box=None):
        """その日の版の Index。取っている最中なら wait 秒まで待つ。取れなければ None"""
        return self._get(feed, ymd, wait, box)[0]

    def _get(self, feed, ymd, wait=25.0, box=None):
        """(get と同じ Index, 使う表の印)。使えなければ (None, None)"""
        if not self.enabled():
            return None, None
        res = self.pick(feed, ymd)
        with self.lock:
            k = self._key(feed, res, box)
            idx = self.loaded.get(k)
            stale = idx is not None and self.now() - idx.meta.get('fetched', 0) > REFRESH
            recent_fail = self.now() - self.failed.get(k, -1e9) < RETRY_AFTER
            ev = self.busy.get(k)
            start = ev is None and (idx is None or stale) and not recent_fail
            if start:
                ev = self.busy[k] = threading.Event()
            if idx is not None or ev is not None:
                self.used[k] = self.now()
        if start:
            if stale:
                for x in (self._path(feed, res, k[2]),):
                    try:
                        os.remove(x)
                    except OSError:
                        pass
                if k[2]:
                    try:
                        os.remove(os.path.join(self.dir, f"{feed['id']}-{re.sub(r'[^A-Za-z0-9-]', '', res)[:40]}.zip.at"))
                    except OSError:
                        pass
            threading.Thread(target=self._load, args=(feed, res, k), daemon=True).start()
        if idx is not None:
            return idx, k                 # 古い版でも、取り直している間はそれを使う
        if ev is not None and wait > 0:
            ev.wait(wait)
        with self.lock:
            return self.loaded.get(k), k

    def indexes(self, box, ymd, wait=25.0):
        """範囲に関わる時刻表の、その日の版の Index を全部（取っている最中の物は、合わせて wait 秒まで待つ）。
        (Index の並び, まだ取っている物があるか)"""
        feeds = self.feeds_for(box)
        for f in feeds:
            self.get(f, ymd, wait=0, box=box)
        deadline = time.time() + wait
        out, pending = [], False
        for f in feeds:
            idx, k = self._get(f, ymd, wait=max(0.0, deadline - time.time()), box=box)
            if idx is not None:
                out.append(idx)
            elif k is not None:
                with self.lock:
                    pending = pending or k in self.busy
        return out, pending


def source_of(idx):
    m = idx.meta
    res = m.get('res') or ''
    ver = m.get('label')
    if ver is None:
        ver = f'{res[:4]}-{res[4:6]}-{res[6:]}' if re.fullmatch(r'\d{8}', res) else ''
    fetched = datetime.datetime.fromtimestamp(m.get('fetched', 0), JST)
    return {'agency': m.get('agency'), 'version': ver, 'fetched': fetched.strftime('%Y-%m-%dT%H:%M'), **(m.get('credit') or {})}


def sources_of(idxs):
    """出典の並び（同じ時刻表の近くだけの形が 2 つあっても 1 つ）"""
    out, seen = [], set()
    for i in idxs:
        s = source_of(i)
        k = (i.meta.get('feed'), s['version'])
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out


def area_box(points):
    return bus_feeds.box_of(points, NEAR_M + 200)


def door_table(store, points, ymd, start, end, idxs=None, used=None):
    """points: [(lat, lng)]。乗換なしのバス・電車で、戸口から戸口まで（停留所や駅まで歩く・待つ・乗る・歩く）の目安（分）。
    start〜end の 1 時間ごとに出たとして求め、その中央値。半分より多くの時刻で便が無い組みは None。
    used（並び）を渡すと、表に使った（いちばん早い便を出した）時刻表の Index を入れる"""
    n = len(points)
    best_of = {}                                           # (i, j, 出る時刻) → その値を出した Index
    times = list(range(start, max(start + 1, end - 30), 60))[:12]
    got = [[{} for _ in range(n)] for _ in range(n)]       # [i][j] → 出る時刻 → 分
    if idxs is None:
        idxs, _ = store.indexes(area_box(points), ymd)
    for idx in idxs:
        on = idx.services_on(ymd)
        if not on:
            continue
        near = [idx.near(*p) for p in points]
        dest = {}
        for j, lst in enumerate(near):
            for st, wb in lst:
                dest.setdefault(st, []).append((j, wb))
        for i in range(n):
            if not near[i]:
                continue
            for t in times:
                for st, v in idx.scan(near[i], t, on).items():
                    for j, wb in dest.get(st, ()):
                        if j == i:
                            continue
                        x = v + wb
                        cur = got[i][j].get(t)
                        if cur is None or x < cur:
                            got[i][j][t] = x
                            best_of[(i, j, t)] = idx
    out = []
    for i in range(n):
        row = []
        for j in range(n):
            vals = sorted(got[i][j].values())
            ok = vals and len(vals) * 2 >= len(times)
            row.append(vals[len(vals) // 2] if ok else None)
            if ok and used is not None:
                for t in got[i][j]:
                    x = best_of.get((i, j, t))
                    if x is not None and all(x is not y for y in used):
                        used.append(x)
        out.append(row)
    return out


def find(store, a, b, ymd, after, limit=LIMIT, info=None):
    """範囲に関わる時刻表の便をまとめて、着く時刻の早い順に limit まで。(便, 返す便の時刻表の出典)。info を渡すと pending を入れる"""
    idxs, pending = store.indexes(area_box([a, b]), ymd)
    if info is not None:
        info['pending'] = pending
    found, seen = [], set()
    for idx in idxs:
        for trip in idx.search(a, b, ymd, after, limit):
            sig = (trip['agency'], trip['route'], trip['board']['time'], trip['board']['name'], trip['alight']['time'], trip['alight']['name'])
            if sig in seen:
                continue
            seen.add(sig)
            found.append((trip, idx))
    found.sort(key=lambda x: (cost(_minutes(x[0]['alight']['time']), x[0]['walkTo'], x[0]['walkFrom']), x[0]['walkTo'] + x[0]['walkFrom']))
    found = found[:limit]
    shown = []
    for t, idx in found:
        t['source'] = source_of(idx)
        if all(idx is not y for y in shown):
            shown.append(idx)
    return [t for t, _ in found], sources_of(shown)


# ---- 形の無い事業者の線を道に沿わせる（停留所を順に経由地にした車の道） ----
_road = {}
_road_lock = threading.Lock()


def road_line(trip, through):
    """停留所を順につないだ線を、through(停留所の並び) が返す道の線に置き換える（取れなければそのまま）"""
    k = trip.pop('_pattern', None)
    if trip.get('shape') or trip.get('mode') == 'train' or not k or len(trip['line']) < 2:
        return trip
    with _road_lock:
        hit = _road.get(k)
    if hit is None:
        pts = trip['line']
        if len(pts) > 40:
            pts = pts[::math.ceil(len(pts) / 40)] + [pts[-1]]
        got = through(pts)
        if got and len(got) > 1:
            hit = thin(got)
            with _road_lock:
                if len(_road) > 2000:
                    _road.clear()
                _road[k] = hit
    if hit:
        trip['line'] = hit
    return trip


def with_parts(trip, a, b):
    """便の線を「停留所まで歩く・乗る・停留所から歩く」の 3 つに分けた物を足す（どれも [経度, 緯度] の並び）。
    a・b は区間の 2 地点（緯度, 経度）。歩く部分は、地点と停留所を結ぶ直線"""
    bd, al = trip['board'], trip['alight']
    trip['parts'] = {'walkTo': [[round(a[1], 5), round(a[0], 5)], [bd['lng'], bd['lat']]],
                     'ride': trip['line'],
                     'walkFrom': [[al['lng'], al['lat']], [round(b[1], 5), round(b[0], 5)]]}
    return trip


# ---- 問い合わせの回数の上限（1 時間あたり。人ごとと全体） ----
class Rate:
    def __init__(self, per_client, total):
        self.per_client, self.total = per_client, total
        self.hits, self.all, self.lock = {}, [], threading.Lock()

    def take(self, who, now=None, n=1):
        """n 回分を数える（届かなければ数えずに False）"""
        now = time.time() if now is None else now
        with self.lock:
            self.all = [t for t in self.all if now - t < 3600]
            mine = [t for t in self.hits.get(who, []) if now - t < 3600]
            if (self.total > 0 and len(self.all) + n > self.total) or (self.per_client > 0 and len(mine) + n > self.per_client):
                self.hits[who] = mine
                return False
            mine.extend([now] * n)
            if self.total > 0:
                self.all.extend([now] * n)
            self.hits[who] = mine
            if len(self.hits) > 5000:
                self.hits = {w: v for w, v in self.hits.items() if v and now - v[-1] < 3600}
            return True


def parse_point(s):
    try:
        lat, lng = (float(x) for x in str(s).split(','))
    except ValueError:
        return None
    if not (20 < lat < 50 and 120 < lng < 155):
        return None
    return lat, lng


def parse_box(s):
    """'南,西,北,東' → (南, 西, 北, 東) か None（日本の外・逆さま・1 度より広い範囲は None）"""
    try:
        v = [float(x) for x in str(s).split(',')]
    except ValueError:
        return None
    if len(v) != 4 or not all(math.isfinite(x) for x in v):
        return None
    lat1, lng1, lat2, lng2 = v
    if not (parse_point(f'{lat1},{lng1}') and parse_point(f'{lat2},{lng2}')) or lat1 > lat2 or lng1 > lng2:
        return None
    if lat2 - lat1 > 1 or lng2 - lng1 > 1:
        return None
    return lat1, lng1, lat2, lng2


def parse_query(q):
    """?from=緯度,経度&to=緯度,経度&date=YYYY-MM-DD&after=HH:MM → (a, b, ymd, after) か None"""
    a, b = parse_point(q.get('from', [''])[0]), parse_point(q.get('to', [''])[0])
    date = q.get('date', [''])[0]
    after = _minutes(q.get('after', [''])[0])
    if not a or not b or after is None or after > 30 * 60 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
        return None
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        return None
    return a, b, ymd_int(date), after
