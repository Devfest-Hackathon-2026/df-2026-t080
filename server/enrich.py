# 候補に、写真（Wikipedia の記事と Wikidata の代表の写真）と、道に沿った移動時間・経路の線（OpenStreetMap の OSRM）を足す。
# 本番では写真は Places API の写真、移動は Routes API（徒歩・車）に置き換える。
# 日本の電車の経路は Google の API でも出ないため、乗り物の線は道に沿った線（バスに近い）で描く。
import hashlib, html, json, re, threading, time, urllib.error, urllib.parse, urllib.request

import places

UA = places.UA
OSRM = 'https://routing.openstreetmap.de/routed-{prof}/{svc}/v1/driving/{coords}'
WIKI = 'https://ja.wikipedia.org/w/api.php'
OSRM_GAP = 1.0                                   # 公開サーバーの決まりで 1 秒に 1 回まで
_osrm = threading.Lock()
_osrm_last = [0.0]
_line_locks = {}
_line_guard = threading.Lock()


def get_json(url, lock, timeout=20):
    """1 つずつ、前の問い合わせから OSRM_GAP 秒あけて送る（同時には送らない）"""
    with lock:
        wait = OSRM_GAP - (time.time() - _osrm_last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=timeout) as r:
                return json.load(r)
        except Exception:
            return None
        finally:
            _osrm_last[0] = time.time()


def lnglat(p):
    return f"{p['lng']:.5f},{p['lat']:.5f}"


# ---- 移動時間の表（全部の点どうし・分） ----
def matrix(points):
    """points: [{lat,lng}] → {'walk': [[分]], 'drive': [[分]], 'walkM': [[歩く道のりの m]]}。取れなければ None"""
    coords = ';'.join(lnglat(p) for p in points)
    out = {}
    for prof, key in (('foot', 'walk'), ('car', 'drive')):
        ask = 'duration,distance' if prof == 'foot' else 'duration'
        d = get_json(OSRM.format(prof=prof, svc='table', coords=coords) + '?annotations=' + ask, _osrm, 40)
        if not d or d.get('code') != 'Ok':
            return None
        out[key] = [[None if v is None else round(v / 60, 1) for v in row] for row in d['durations']]
        if prof == 'foot' and d.get('distances'):
            out['walkM'] = [[None if v is None else round(v) for v in row] for row in d['distances']]
    return out


# ---- 経路の線 ----
def leg_key(a, b, mode):
    """区間の作り置きの鍵。座標の要約（座標そのものは書かない）"""
    prof = 'foot' if mode == 'walk' else 'car'
    return prof + ':' + hashlib.sha1(f'{a[0]:.5f},{a[1]:.5f}>{b[0]:.5f},{b[1]:.5f}'.encode()).hexdigest()[:16]


def leg_line(a, b, mode, cache):
    """a, b: [lng, lat]。徒歩は歩く道、乗り物は車の道に沿った線（[lng, lat] の並び）"""
    prof = 'foot' if mode == 'walk' else 'car'
    key = leg_key(a, b, mode)
    if key in cache:
        return cache[key]
    with _line_guard:
        mine = _line_locks.setdefault(key, threading.Lock())
    with mine:                              # 同じ区間を同時に聞かれたら、先の問い合わせの結果を使う
        line = cache.get(key) or _leg_line(a, b, prof)
        if line:
            cache[key] = line
    with _line_guard:
        _line_locks.pop(key, None)
    return line


def _leg_line(a, b, prof):
    url = OSRM.format(prof=prof, svc='route', coords=f'{a[0]:.5f},{a[1]:.5f};{b[0]:.5f},{b[1]:.5f}') + '?overview=full&geometries=geojson'
    d = get_json(url, _osrm)
    if not d or d.get('code') != 'Ok' or not d.get('routes'):
        return None
    pts = d['routes'][0]['geometry']['coordinates']
    step = max(1, len(pts) // 300)          # 線の点は 300 くらいまで
    line = [[round(x, 5), round(y, 5)] for x, y in pts[::step]]
    if pts and line[-1] != [round(pts[-1][0], 5), round(pts[-1][1], 5)]:
        line.append([round(pts[-1][0], 5), round(pts[-1][1], 5)])
    return line


def road_through(points):
    """points: [[lng, lat]]。順に経由する車の道の線（[lng, lat] の並び）。取れなければ None"""
    coords = ';'.join(f'{x:.5f},{y:.5f}' for x, y in points)
    d = get_json(OSRM.format(prof='car', svc='route', coords=coords) + '?overview=full&geometries=geojson', _osrm, 15)
    if not d or d.get('code') != 'Ok' or not d.get('routes'):
        return None
    return d['routes'][0]['geometry']['coordinates']


# ---- 写真（Wikipedia の記事の写真と、Wikidata の代表の写真） ----
# Wikimedia（Wikipedia・Wikidata・Commons）は問い合わせが多いと断られる（429）。エリアごとに数回へまとめ、
# どのサイトへの問い合わせも 1 つずつ、前の問い合わせから間をあけて送る。
BAD_FILE = re.compile(r'\.svg|map|locator|location|地図|位置図|logo|ロゴ|紋|seal', re.I)
SPARQL = 'https://query.wikidata.org/sparql'
_wiki_lock = threading.Lock()
_wiki_last = [0.0]


WIKI_GAP = 2.5                                   # 問い合わせの間隔（秒）


def _ask(url, timeout=20):
    """1 つずつ、間をあけて送る。断られたら（429）相手が言う時間だけ待って 1 回だけやり直す"""
    for attempt in range(2):
        retry = 0.0
        with _wiki_lock:
            wait = WIKI_GAP - (time.time() - _wiki_last[0])
            if wait > 0:
                time.sleep(wait)
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=timeout) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt:
                    return None
                try:
                    retry = min(60.0, float(e.headers.get('Retry-After') or 20))
                except ValueError:
                    retry = 20.0
            except Exception:
                return None
            finally:
                _wiki_last[0] = time.time()
        time.sleep(retry)
    return None


def wiki(params):
    """日本語版 Wikipedia の API"""
    return _ask(WIKI + '?' + urllib.parse.urlencode({'format': 'json', 'formatversion': 2, **params}))


def wdqs(query):
    """Wikidata の SPARQL → 結果の行の並び（失敗したら None）"""
    d = _ask(SPARQL + '?' + urllib.parse.urlencode({'query': query, 'format': 'json'}), 40)
    return None if d is None else ((d.get('results') or {}).get('bindings') or [])


def photo_key(p):
    """写真の作り置きの鍵。同じ名前の別の場所（金沢と鎌倉の妙法寺など）を分けるため、名前に位置（およそ 1 km の升目）を添える"""
    return f"{p['name']}@{p['lat']:.2f},{p['lng']:.2f}"


def _clusters(plist, km=4.0):
    groups = []
    for p in plist:
        for g in groups:
            if places.dist_m((g['lat'], g['lng']), (p['lat'], p['lng'])) <= km * 1000:
                g['members'].append(p)
                break
        else:
            groups.append({'lat': p['lat'], 'lng': p['lng'], 'members': [p]})
    return groups


def _base(title):
    return re.sub(r'\s*[（(].*?[）)]\s*$', '', title)


# 名前の最初の語のあとに続いても、同じ場所を指す語（支店・本堂・展望台など）
SAME_PLACE = re.compile(r'(店|本館|本堂|境内|展望台|テラス|フロア|地区)$|^展望')
# 町・区などの記事の題（建物や通りの名前から、それがある町の記事へ転送されることがある）
TOWN = re.compile(r'(町|村|区|市|郡|丁目|地区|地域)$')
# 括弧の中が別名ではなく、場所の説明のとき（「芦ノ湖畔（元箱根港付近）」など）
NOT_ALIAS = re.compile(r'付近|周辺|側|方面|日帰り|入口|前$')
BAD_TITLE = re.compile(r'[|"\\#<>\[\]{}]')
# 記事の短い説明が、町や地域の記事だと言っているとき
TOWN_NOTE = re.compile(r'地名|町名|大字|地域|行政区|市町村')
# 名前の後ろの、場所そのものではなく「その場所の〜」を表す語（「若草山山頂」の山頂・「湯ノ湖畔」の畔）
PART = re.compile(r'(散策路|遊歩道|プロムナード|周辺|山頂|展望台|展望所|見晴らし台|海岸)$|(?<=湖)畔$')
QID = re.compile(r'^Q\d{1,12}$')
POINT = re.compile(r'^Point\(([-\d.eE]+) ([-\d.eE]+)\)$')


def _tokens(name):
    return [places.norm_name(x) for x in re.split(r'[\s　]+', re.sub(r'[（(].*?[）)]', '', name).strip()) if x]


def name_variants(name):
    """場所の名前を、記事の題や Wikidata の名前とぴったり合わせて探すときの書き方。
    括弧を外した名前・括弧の中の別名（「高徳院（鎌倉大仏）」の鎌倉大仏）・空白を詰めた名前・
    後ろの支店や本堂などの語を外した名前（「瓢亭 本店」の瓢亭）・名前の最後の語（「長照山 雲龍院」の雲龍院）"""
    out = []

    def add(x):
        x = re.sub(r'[\s　]+', ' ', x).strip()
        if len(places.norm_name(x)) >= 2 and x not in out and not BAD_TITLE.search(x):
            out.append(x)
    base = re.sub(r'[（(].*?[）)]', '', name).strip()
    add(base)
    for inner in re.findall(r'[（(](.*?)[）)]', name):
        if not NOT_ALIAS.search(inner):
            add(inner)
    toks = [x for x in re.split(r'[\s　]+', base) if x]
    if len(toks) > 1:
        add(''.join(toks))
        core = list(toks)
        while len(core) > 1 and SAME_PLACE.search(core[-1]):
            core.pop()
        if len(core) < len(toks):
            add(' '.join(core))
            add(''.join(core))
        if not SAME_PLACE.search(toks[-1]) and re.search(r'[^\x00-\x7f]', toks[-1]):
            add(toks[-1])
    for x in list(out):
        y = x
        while PART.search(y):
            y = PART.sub('', y).strip()
            add(y)
        if y.endswith('稲荷神社'):
            add(y[:-2] + '社')
    for x in list(out):
        if 'ヶ' in x or 'ケ' in x:
            add(x.replace('ヶ', '\0').replace('ケ', 'ヶ').replace('\0', 'ケ'))
    return out


def area_words(area_name, p):
    """エリアと地区の名前（そろえた形）。「Bakery&Table 箱根」の箱根のように、名前の中の地名だけで記事や項目を引かないため"""
    return {places.norm_name(w) for w in re.split(r'[・･\s/／]', area_name or '') + [p.get('district') or ''] if len(w) >= 2}


def variants_of(p, area_name=''):
    """name_variants のうち、エリアや地区の名前だけのもの（名前そのものは除く）を外した書き方"""
    towns = area_words(area_name, p) - {places.norm_name(p['name'])}
    return [v for v in name_variants(p['name']) if places.norm_name(v) not in towns]


def first_word_only(title, name):
    """記事の題が、場所の名前の最初の語とだけ合う（「輪王寺 逍遥園」の輪王寺）。その記事の写真は別の場所の写真になる"""
    toks = _tokens(name)
    return (len(toks) > 1 and len(toks[0]) >= 2 and places.norm_name(_base(title)) == toks[0]
            and not all(SAME_PLACE.search(x) for x in toks[1:]))


def name_score(title, name):
    """記事の題と場所の名前の合い方。3 ぴったり・2 名前の最後の語と同じか、最初の語と同じで残りが支店・本堂などだけ・
    1 ほぼ同じ長さで一部が合う・0 合わない。最初の語だけが合う記事は採らない（first_word_only）"""
    t, n = places.norm_name(_base(title)), places.norm_name(name)
    toks = _tokens(name)
    first = toks[0] if toks else ''
    last = toks[-1] if len(toks) > 1 else ''
    if not t or not n:
        return 0
    if t == n:
        return 3
    if len(last) >= 2 and t == last:
        return 2
    if len(first) >= 2 and t == first:
        return 2 if all(SAME_PLACE.search(x) for x in toks[1:]) else 0
    other = re.search(r'(駅|港|停|線|IC|インター)$', t) and not re.search(r'(駅|港|停|線)$', n)
    if not other and ((n in t and len(n) / len(t) >= 0.75) or (t in n and len(t) / len(n) >= 0.75)):
        return 1
    return 0


def wiki_page(title):
    return 'https://ja.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_'))


def add_photos(plist, cache, area_name=''):
    """写真を探し、作者とライセンスを足す（作者とライセンスが分からない写真は使わない）。
    Wikipedia の記事の写真が無い・使えない場所は、Wikidata の代表の写真を探す"""
    todo, match, items = _article_photos(plist, cache, area_name)
    add_credits(plist, cache)
    return wikidata_photos(plist, cache, todo, match, items, area_name)


def find_photos(plist, cache, area_name=''):
    """Wikipedia の記事の写真だけを探す（作者とライセンスは add_credits）"""
    _article_photos(plist, cache, area_name)
    return plist


def _article_photos(plist, cache, area_name=''):
    """場所ごとに、近く（1.2 km 以内）にある同じ名前の記事の写真を探す。見つからなければ、名前の書き方（name_variants）と
    同じ題の記事（2 km 以内）。作り置きの写真のうち、記事が名前の最初の語とだけ合うものは外す（写真なしにする）。
    → (この回に探した場所, 写真の鍵 → 記事の題, 記事の題 → Wikidata の項目)。断られたときは何も決めない（次の機会にもう一度）"""
    for p in plist:
        k = photo_key(p)
        if p.get('photo') and first_word_only(p['photo'].get('title') or '', p['name']):
            p['photo'] = None
        if cache.get(k) and first_word_only(cache[k].get('title') or '', p['name']):
            cache[k] = None
    todo = [p for p in plist if 'photo' not in p and photo_key(p) not in cache]
    match = {}                                   # 写真の鍵 → 記事の題
    weak = {}                                    # 一部だけ合う記事（同じ名前の記事がなければ使う）
    items = {}                                   # 記事の題 → Wikidata の項目
    extra = 0                                    # 打ち切られて探し直した数
    for g in _clusters(todo):
        r = max(places.dist_m((g['lat'], g['lng']), (m['lat'], m['lng'])) for m in g['members']) + 1200
        d = wiki({'action': 'query', 'list': 'geosearch', 'gscoord': f"{g['lat']}|{g['lng']}", 'gsradius': int(min(10000, r)), 'gslimit': 500})
        if d is None:
            return [], {}, {}
        pages = (d.get('query') or {}).get('geosearch') or []
        if len(pages) >= 500:
            # 数で打ち切られると、範囲の中の記事の一部だけが返る（近い順の先頭ではない）。狭い範囲に分けて探し直す（エリアで 4 回まで）
            for s in _clusters(g['members'], 1.5)[:max(0, 4 - extra)]:
                extra += 1
                r2 = max(places.dist_m((s['lat'], s['lng']), (m['lat'], m['lng'])) for m in s['members']) + 1200
                d = wiki({'action': 'query', 'list': 'geosearch', 'gscoord': f"{s['lat']}|{s['lng']}", 'gsradius': int(r2), 'gslimit': 500})
                if d is None:
                    return [], {}, {}
                pages = pages + ((d.get('query') or {}).get('geosearch') or [])
        for m in g['members']:
            cands = []
            towns = area_words(area_name, m) - {places.norm_name(m['name'])}
            for pg in pages:
                sc = name_score(pg['title'], m['name'])
                dm = places.dist_m((m['lat'], m['lng']), (pg['lat'], pg['lon']))
                if sc and dm <= 1200 and places.norm_name(_base(pg['title'])) not in towns:
                    cands.append((-sc, dm, pg['title']))
            if cands:
                best = min(cands)
                (match if best[0] <= -2 else weak)[photo_key(m)] = best[2]
    rest = [p for p in todo if photo_key(p) not in match]
    titles = sorted({v for p in rest for v in variants_of(p, area_name)})
    normal, moved_to, fragment, found = {}, {}, set(), {}
    for k in range(0, len(titles), 40):          # 同じ名前の記事（位置が近いときだけ）
        d = wiki({'action': 'query', 'prop': 'coordinates|description|pageprops', 'ppprop': 'disambiguation', 'colimit': 'max',
                  'redirects': 1, 'titles': '|'.join(titles[k:k + 40])})
        if d is None:
            break
        q = d.get('query') or {}
        for x in q.get('normalized') or []:
            normal[x['from']] = x['to']
        for x in q.get('redirects') or []:
            moved_to[x['from']] = x['to']
            if x.get('tofragment'):
                fragment.add(x['from'])        # 大きな記事の一節への転送。その記事の写真は別の物になる
        for pg in q.get('pages') or []:
            if not pg.get('missing') and not pg.get('invalid') and 'disambiguation' not in (pg.get('pageprops') or {}):
                found[pg['title']] = ((pg.get('coordinates') or [None])[0], pg.get('description') or '')
    words = [w for w in re.split(r'[・･\s/／]', area_name) if len(w) >= 2]
    for p in rest:
        for v in variants_of(p, area_name):
            n = normal.get(v, v)
            t = moved_to.get(n, n)
            if n in fragment or t not in found or first_word_only(t, p['name']):
                continue
            moved = t != n
            if moved and not name_score(t, v) and TOWN.search(_base(t)) and not TOWN.search(v):
                continue                       # 建物や通りの名前から、それがある町の記事への転送
            c, desc = found[t]
            if places.norm_name(v) != places.norm_name(p['name']) and TOWN_NOTE.search(desc):
                continue                       # 名前の一部や別の書き方で引いた町・地域の記事
            if c:
                if places.dist_m((p['lat'], p['lng']), (c['lat'], c['lon'])) <= 2000:
                    match[photo_key(p)] = t
                    break
            elif not moved and any(w in desc for w in words + [p.get('district') or ''] if len(w) >= 2):
                # 記事に位置がないときは、転送でない記事の短い説明にエリアか地区の名前があれば採る（同じ名前の別の場所を避ける）
                match[photo_key(p)] = t
                break
    for k, v in weak.items():
        match.setdefault(k, v)
    titles = sorted(set(match.values()))
    thumbs = {}
    for k in range(0, len(titles), 40):          # 写真はまとめて
        d = wiki({'action': 'query', 'prop': 'pageimages|pageprops', 'piprop': 'thumbnail|name', 'pithumbsize': 500, 'pilimit': 50,
                  'ppprop': 'wikibase_item', 'titles': '|'.join(titles[k:k + 40])})
        if d is None:
            return [], {}, {}
        for pg in (d.get('query') or {}).get('pages') or []:
            qid = (pg.get('pageprops') or {}).get('wikibase_item') or ''
            if QID.match(qid):
                items[pg['title']] = qid
            th = pg.get('thumbnail') or {}
            if th.get('source') and not BAD_FILE.search(pg.get('pageimage') or ''):
                thumbs[pg['title']] = {'url': th['source'], 'title': pg['title'], 'page': wiki_page(pg['title'])}
    for p in todo:
        cache[photo_key(p)] = thumbs.get(match.get(photo_key(p), ''))
    for p in plist:
        if 'photo' not in p and photo_key(p) in cache:
            p['photo'] = cache[photo_key(p)]
    return todo, match, items


def _sparql(labels, items):
    """名前（日本語の名前か別名がぴったり同じ）で引く項目の位置と写真、と、決まった項目の写真。
    名前で引く項目が町や地域（人の住む所・行政区画とその下の種類）なら ?town に印が付く"""
    parts = []
    if labels:
        parts.append('{ VALUES ?label { %s } { ?item rdfs:label ?label } UNION { ?item skos:altLabel ?label } '
                     '?item wdt:P625 ?coord . ?item wdt:P18 ?image . '
                     'OPTIONAL { ?item wdt:P31/wdt:P279* ?town . VALUES ?town { wd:Q486972 wd:Q56061 } } }' % ' '.join(json.dumps(x, ensure_ascii=False) + '@ja' for x in labels))
    if items:
        parts.append('{ VALUES ?item { %s } ?item wdt:P18 ?image . }' % ' '.join('wd:' + q for q in items))
    return 'SELECT ?item ?label ?coord ?image ?town WHERE { hint:Query hint:optimizer "None" . ' + ' UNION '.join(parts) + ' }'


def wikidata_photos(plist, cache, todo, match, items, area_name=''):
    """この回に探しても写真が無かった場所に、Wikidata の代表の写真（P18）を探す。
    1. 記事が見つかった場所は、その記事の項目の写真（記事の写真が地図だったときなど）
    2. ほかは、名前の書き方（name_variants）のどれかと日本語の名前か別名がぴったり同じで、位置が 2 km 以内の項目のうち、一番近いものの写真。
       町や地域の項目は、通り・商店街の場所が名前そのままで引いたときだけ使う（「かっぱ橋道具街」は使い、「材木座海岸」の材木座は使わない）
    写真の URL（幅 500）・作者・ライセンスは Commons からまとめて取り、表示だけで使えるライセンスの写真だけを使う"""
    need = [p for p in todo if cache.get(photo_key(p)) is None]
    if not need:
        return plist
    item_of = {photo_key(p): items.get(match.get(photo_key(p), ''), '') for p in need}
    labels = sorted({v for p in need for v in variants_of(p, area_name)})
    ids = sorted({q for q in item_of.values() if q})
    rows = []
    for k in range(0, max(1, len(labels)) if labels or ids else 0, 60):
        r = wdqs(_sparql(labels[k:k + 60], ids if k == 0 else []))
        if r is None:
            return _retry_later(plist, cache, need)
        rows += r
    by_item, by_label, towns = {}, {}, set()
    for b in rows:
        qid = str((b.get('item') or {}).get('value') or '').rsplit('/', 1)[-1]
        file = urllib.parse.unquote(str((b.get('image') or {}).get('value') or '').rsplit('/', 1)[-1]).replace('_', ' ')
        if not QID.match(qid) or not file or BAD_FILE.search(file):
            continue
        if b.get('town'):
            towns.add(qid)
        if 'label' in b:
            m = POINT.match(str((b.get('coord') or {}).get('value') or ''))
            if m:
                by_label.setdefault(b['label'].get('value'), []).append((float(m.group(2)), float(m.group(1)), file, qid))
        else:
            by_item.setdefault(qid, file)
    pick = {}                                    # 写真の鍵 → (ファイル, 題, 項目)
    for p in need:
        k = photo_key(p)
        if item_of[k] in by_item:
            pick[k] = (by_item[item_of[k]], match[k], item_of[k])
            continue
        best = None
        whole = p.get('kind') == 'street'
        for v in variants_of(p, area_name):
            for lat, lng, file, qid in by_label.get(v, []):
                if qid in towns and not (whole and places.norm_name(v) == places.norm_name(p['name'])):
                    continue
                dm = places.dist_m((p['lat'], p['lng']), (lat, lng))
                if dm <= 2000 and (best is None or dm < best[0]):
                    best = (dm, file, v, qid)
        if best:
            pick[k] = best[1:]
    files = sorted({f for f, _, _ in pick.values()})
    got = {}
    for k in range(0, len(files), 50):
        d = wiki({'action': 'query', 'prop': 'imageinfo', 'iiprop': 'extmetadata|url', 'iiurlwidth': 500, 'iiextmetadatalanguage': 'en',
                  'iiextmetadatafilter': 'Artist|LicenseShortName|LicenseUrl|NonFree', 'titles': '|'.join('File:' + f for f in files[k:k + 50])})
        if d is None:
            return _retry_later(plist, cache, need)
        for pg in (d.get('query') or {}).get('pages') or []:
            info = (pg.get('imageinfo') or [None])[0]
            c = credit_of(info) if info else None
            url = str((info or {}).get('thumburl') or '')
            if c and url.startswith('https://'):
                got[pg.get('title', '').split(':', 1)[-1]] = {'url': url, **c}
    for p in need:
        k = photo_key(p)
        if k in pick and pick[k][0] in got:
            file, title, qid = pick[k]
            page = wiki_page(title) if match.get(k) == title else f'https://www.wikidata.org/wiki/{qid}'
            cache[k] = {**got[file], 'title': title, 'page': page}
    mine = {id(p) for p in need}
    for p in plist:
        if id(p) in mine and not p.get('photo') and cache.get(photo_key(p)):
            p['photo'] = cache[photo_key(p)]
    return plist


def _retry_later(plist, cache, need):
    """断られたときは、写真なしと決めずに、次の機会にもう一度探す"""
    for p in need:
        cache.pop(photo_key(p), None)
        if 'photo' in p and not p['photo']:
            del p['photo']
    return plist


# ---- 写真の作者とライセンス（Wikimedia Commons の説明のページの内容） ----
# 作者とライセンスが分かり、表示だけで使えるライセンス（CC BY・CC BY-SA・CC0・パブリックドメイン）の写真だけを使う
CC = re.compile(r'^CC BY(-SA)? \d\.\d( [a-z]{2,3})?$', re.I)
PD = re.compile(r'^(public domain|pd\b|cc0\b)', re.I)
CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'


def file_of(url):
    """写真の URL（…/thumb/0/08/<ファイル>/500px-…）からファイルの名前"""
    m = re.search(r'/thumb/[0-9a-f]/[0-9a-f]{2}/([^/]+)/', url or '')
    return urllib.parse.unquote(m.group(1)).replace('_', ' ') if m else ''


def plain(html_text):
    t = re.sub(r'<[^>]+>', ' ', html_text or '')
    return re.sub(r'\s+', ' ', html.unescape(t)).strip()


def credit_of(info):
    """imageinfo の 1 件 → {author, license, licenseUrl, source}。使えない写真は None"""
    meta = {k: (v or {}).get('value') for k, v in (info.get('extmetadata') or {}).items()}
    if str(meta.get('NonFree') or '').lower() == 'true':
        return None
    short = plain(meta.get('LicenseShortName') or '')
    url = str(meta.get('LicenseUrl') or '').strip()
    if url.startswith('//'):
        url = 'https:' + url
    author = plain(meta.get('Artist') or '')
    source = info.get('descriptionurl') or ''
    if len(author) > 80 or not source.startswith('https://'):
        return None
    if CC.match(short):
        if not author or not url.startswith('http'):
            return None
        lic = short
    elif PD.match(short):
        lic = 'CC0' if short.upper().startswith('CC0') else 'Public domain'
        url = url if url.startswith('http') else (CC0_URL if lic == 'CC0' else '')
    else:
        return None
    return {'author': author, 'license': lic, 'licenseUrl': url, 'source': source}


def add_credits(plist, cache):
    """場所の写真（作り置きの分も）に作者とライセンスを足す。まとめて聞き、使えない写真は外す"""
    photos = [p['photo'] for p in plist if p.get('photo')]
    photos += [cache[photo_key(p)] for p in plist if cache.get(photo_key(p))]
    want = {}
    for ph in photos:
        if 'license' not in ph and file_of(ph.get('url')):
            want.setdefault(file_of(ph['url']), []).append(ph)
    names = sorted(want)
    for k in range(0, len(names), 50):
        chunk = names[k:k + 50]
        d = wiki({'action': 'query', 'prop': 'imageinfo', 'iiprop': 'extmetadata|url', 'iiextmetadatalanguage': 'en',
                  'iiextmetadatafilter': 'Artist|LicenseShortName|LicenseUrl|NonFree',
                  'titles': '|'.join('File:' + n for n in chunk)})
        if d is None:
            break                                # 断られたときは、次の機会にもう一度
        for pg in (d.get('query') or {}).get('pages') or []:
            name = pg.get('title', '').split(':', 1)[-1]
            info = (pg.get('imageinfo') or [None])[0]
            if name not in want:
                continue
            c = credit_of(info) if info else None
            for ph in want[name]:
                ph.update(c or {'license': ''})
    bad = lambda ph: bool(ph) and 'license' in ph and not ph['license']
    for p in plist:
        if bad(p.get('photo')):
            p['photo'] = None
        if bad(cache.get(photo_key(p))):
            cache[photo_key(p)] = None
    return plist
