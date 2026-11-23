# 候補を集めている間の待ち画面に出す、エリアの見どころとお店（名前・特徴・写真）。
# Gemini と Places を新しく呼ばない。使うのは、すでに手元にある物だけ:
#   - 頼んだエリアの作り置き（cache/area-*.json）か例のプラン（sample.json）
#   - 頼んだ出発地を範囲に含む、ほかの作り置きのエリア
#   - 候補集めの頼みのうち、先に届いた人気スポット（famous）・飲食店（food）・カフェ（cafe）の答え
# 場所は種類（人気スポット・隠れた名所・飲食店・カフェ）ごとに分け、一度入れた種類は入れ替えず、まだ無い種類だけを足す。
# 特徴の一言は、候補の画面と同じ Gemini の why（店は看板の品）をそのまま使う。
# 写真は、場所に付いている物か写真の作り置き（cache/photo.json）のうち、作者とライセンスの分かる Wikipedia の写真だけ。
import glob, json, os

import places

GROUPS = ('famous', 'food', 'cafe')   # 待ち画面に並べる種類（作り置きから一度に出すときの並び）
FIELDS = ('id', 'name', 'kind', 'tags', 'district', 'why', 'lat', 'lng')


def limits():
    """種類ごとに出す数。待つ間に目を通せるよう全部で 5 件に収める。隠れた名所は出さない（一言に、その土地を知らないと分からない言葉が多い）"""
    return {'famous': 3, 'food': 1, 'cafe': 1}


def credited(photo):
    """作者とライセンスの分かる写真だけを返す（分からなければ None）"""
    return photo if isinstance(photo, dict) and photo.get('url') and photo.get('license') and photo.get('source') else None


def photo_of(p, cache):
    """写真の作り置きから、その場所の写真を探す（名前が同じで、位置がおよそ 2 km 以内）。英語の候補は日本語の名前で探す"""
    name = places.jname(p) if p.get('ja') else p.get('name')
    try:
        lat, lng = float(p['lat']), float(p['lng'])
    except (KeyError, TypeError, ValueError):
        return None
    hit = credited(cache.get(f'{name}@{lat:.2f},{lng:.2f}'))
    if hit:
        return hit
    head = f'{name}@'
    for k, v in list(cache.items()):
        if not k.startswith(head) or not credited(v):
            continue
        try:
            a, b = (float(x) for x in k[len(head):].split(','))
        except ValueError:
            continue
        if abs(a - lat) <= 0.02 and abs(b - lng) <= 0.02:
            return v
    return None


def group_of(p):
    """候補の種類（GROUPS のどれか）。希望から出した場所・隠れた名所など、待ち画面に出さない物は None"""
    if p.get('kind') == 'food':
        return 'food'
    if p.get('kind') == 'cafe':
        return 'cafe'
    return 'famous' if p.get('source') in (None, 'famous') else None


def pick(plist, cache=None):
    """候補から、待ち画面に出す場所を種類ごとに選ぶ（位置の分からなかった場所・名所でない店は除く）→ {種類: [場所]}。
    種類の中は写真のある場所を先に、同じなら元の並びのまま"""
    lim = limits()
    out = {}
    for p in plist or []:
        if not isinstance(p, dict) or p.get('unfound') or p.get('notSight') or p.get('closed') or not p.get('name'):
            continue
        g = group_of(p)
        if not g:
            continue
        item = {k: p[k] for k in FIELDS if k in p}
        item.setdefault('id', places.place_id(p.get('ja') or p['name']))
        item.setdefault('kind', 'sight')
        item.setdefault('tags', [])
        item['group'] = g
        ph = credited(p.get('photo')) or (photo_of(p, cache) if cache else None)
        if ph:
            item['photo'] = ph
        out.setdefault(g, []).append(item)
    for g, items in out.items():
        items.sort(key=lambda x: 0 if x.get('photo') else 1)
        out[g] = items[:lim[g]]
    return out


def merge(cur, area, got):
    """待ち画面の中身 cur に、まだ無い種類の場所だけを後ろに足す（出した場所は入れ替えない。同じ場所は 2 度出さない）。
    area: エリアの名前（cur にあればそれを使う）。足す物も cur も無ければ None"""
    shown = list((cur or {}).get('places') or [])
    have = {p['group'] for p in shown}
    ids = {p['id'] for p in shown}
    for g in GROUPS:
        if g in have:
            continue
        for p in got.get(g) or []:
            if p['id'] not in ids:
                ids.add(p['id'])
                shown.append(p)
    if cur and len(shown) == len(cur.get('places') or []):
        return cur
    name = (cur or {}).get('area') or area
    return {'area': name, 'places': shown} if shown and name else None


def of_area(area_data, cache=None):
    """エリアの形（area・places）から、待ち画面の中身 {area: エリアの名前, places} を作る。出す場所が無ければ None"""
    if not isinstance(area_data, dict):
        return None
    plist = area_data.get('places')
    name = str((area_data.get('area') or {}).get('name') or '')
    return merge(None, name, pick(plist, cache))


TASK_SOURCE = {'famous': 'famous', 'food': 'food', 'cafe': 'food'}   # 頼み → 候補の source（app.py の候補の組み立てと同じ）


def of_answer(cur, task, raw, area_text, lang, cache=None):
    """先に届いた頼みの答え（famous・food・cafe）を、待ち画面の中身 cur に足す（読めなければ cur のまま）。
    エリアの名前は、cur に無ければ人気スポットの答えから、それも無ければ頼んだエリアの名前"""
    if task not in TASK_SOURCE:
        return cur
    try:
        plist = [places.clean_place(p, TASK_SOURCE[task], lang) for p in places.items(places.obj(raw).get('places'))]
        name = places.clean_area(raw, area_text, lang)['area']['name'] if task == 'famous' else area_text
    except Exception:  # noqa: BLE001
        return cur
    return merge(cur, name, pick([p for p in plist if p], cache)) or cur


class Areas:
    """作り置きのエリアの位置と範囲の一覧（ファイルが変わったときだけ読み直す）"""

    def __init__(self, folder):
        self.folder = folder
        self.seen = {}                 # パス → (更新時刻, {lang, lat, lng, radius, data})

    def scan(self):
        paths = glob.glob(os.path.join(self.folder, 'area-*.json'))
        for path in paths:
            try:
                t = os.path.getmtime(path)
            except OSError:
                continue
            if path in self.seen and self.seen[path][0] == t:
                continue
            try:
                with open(path, encoding='utf-8') as f:
                    d = json.load(f)
                a = d['area']
                self.seen[path] = (t, {'lang': d.get('lang') or 'ja', 'lat': float(a['lat']), 'lng': float(a['lng']),
                                       'radius': float(a.get('radius') or 5), 'data': d})
            except (OSError, ValueError, KeyError, TypeError):
                self.seen[path] = (t, None)
        for path in set(self.seen) - set(paths):
            del self.seen[path]
        return [v for _, v in self.seen.values() if v]

    def near(self, lat, lng, lang, extra=()):
        """(lat, lng) を範囲に含む作り置きのエリアのうち、中心がいちばん近い物（無ければ None）。
        extra: 一緒に比べるエリア（index_of の形）"""
        best = None
        for e in [*self.scan(), *extra]:
            if not e or e['lang'] != lang:
                continue
            km = places.dist_m((e['lat'], e['lng']), (lat, lng)) / 1000
            if km <= e['radius'] and (best is None or km < best[0]):
                best = (km, e['data'])
        return best[1] if best else None


def index_of(d, lang='ja'):
    """エリアの形を、Areas の一覧と同じ形にする（読めなければ None）"""
    try:
        a = d['area']
        return {'lang': d.get('lang') or lang, 'lat': float(a['lat']), 'lng': float(a['lng']), 'radius': float(a.get('radius') or 5), 'data': d}
    except (KeyError, TypeError, ValueError):
        return None
