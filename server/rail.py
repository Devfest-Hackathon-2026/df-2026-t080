# OpenStreetMap の路線（route relation）と駅から、乗換なしの電車で戸口から戸口までの目安（分）を出す。時刻表ではない（何時何分発は出さない）。
#   - 路線と駅は Overpass API で取る。範囲（bus.area_box を bus_feeds の clip・snap で丸めた物）ごとに 1 回だけ取り、
#     cache/rail/ に置く（REFRESH を過ぎたら、古い物を使いながら取り直す）。もっと広い範囲を取ってあれば、それを使う。
#   - Overpass に聞くのは全体で 1 度に 1 つだけ。続けて聞くときは GAP 秒あける。429・504・時間切れの範囲は RETRY_AFTER 秒は聞かない。
#     1 日に聞く数も PER_DAY までにする（Overpass の公開サーバーの利用の決まり。定期的に使う物は 1 日 100 回ほどまで）。
#   - データは © OpenStreetMap contributors（ODbL）。画面に出典を出す。
#   - ZT_RAIL=0 で使わない。
import collections, json, math, os, re, socket, threading, time, traceback, urllib.error, urllib.parse, urllib.request

import bus, bus_feeds

URL = os.environ.get('ZT_OVERPASS_URL', 'https://overpass-api.de/api/interpreter')
UA = bus_feeds.UA
FORMAT = 1                         # 作り置きの形の版（形を変えたら上げる）
REFRESH = 14 * 86400               # 取ってからこの秒数を過ぎたら取り直す
GAP = 5.0                          # 続けて聞くときにあける秒数
RETRY_AFTER = 300                  # 取れなかった範囲を、もう一度聞くまでの秒数
PER_DAY = int(os.environ.get('ZT_RAIL_PER_DAY', '100'))
QUEUE_MAX = 8                      # 取る順番を待たせておく範囲の数の上限
MEM_KEEP = 6                       # メモリに置く範囲の数
DISK_FILES = 300                   # cache/rail/ に置くファイルの数の上限
MAX_BYTES = 64 * 1024 * 1024
TIMEOUT = 120                      # 返事を待つ秒数（問い合わせの timeout:90 より長く）
MODES = ('subway', 'train', 'light_rail', 'monorail', 'tram')
STOP_ROLES = ('stop', 'stop_entry_only', 'stop_exit_only')
PLATFORM_ROLES = ('platform', 'platform_entry_only', 'platform_exit_only')
TAGS = ('name', 'name:en', 'colour', 'route', 'service', 'interval', 'operator', 'network', 'ref')
QUERY = ('[out:json][timeout:90];'
         'relation["type"="route"]["route"~"^(subway|train|light_rail|monorail|tram)$"]({s},{w},{n},{e})->.r;'
         '.r out body;'
         '(node(r.r:"stop");node(r.r:"stop_entry_only");node(r.r:"stop_exit_only");'
         'node(r.r:"platform");node(r.r:"platform_entry_only");node(r.r:"platform_exit_only"););out;')

# 区間の時間の式（止まる分, [(この距離 km 未満, 速さ km/h)], それより長いときの速さ）
SPEED = {
    'subway': (0.6, ((1.0, 40), (2.0, 50)), 55),
    'train': (0.5, ((1.5, 50), (3.0, 60), (8.0, 70)), 90),
    'tram': (0.4, (), 15),
}
WAIT = {'subway': 3, 'tram': 4, 'light_rail': 4, 'monorail': 4, 'train': 5}
STRAIGHT = 1.1                     # 線路の長さ ÷ 駅の間の直線
CELL = 0.01                        # 駅を引く升目（度。1 km ほど）
MIN_PAIR_M = 1200                  # これより近い組み（直線）は、画面がいつも徒歩にするので求めない

NOT_FOR_US = ('新幹線', '寝台', 'shinkansen')
PAID_NAMES = ('ロマンスカー', 'ラピート', 'スカイライナー', 'ミュースカイ', 'romancecar', 'rapi:t', 'skyliner', 'μsky')
# 名前に「特急」の付かない JR の特急（JR の物だけ外す）
JR_EXPRESS = ('サンダーバード', 'はるか', 'くろしお', 'こうのとり', 'きのさき', 'はしだて', 'まいづる', 'はまかぜ', 'スーパーはくと',
              'らくラク', 'ひだ', 'しなの', 'あずさ', 'かいじ', 'ひたち', 'ときわ', '成田エクスプレス', '踊り子', 'しおさい', 'わかしお',
              'さざなみ', 'あやめ', 'スワローあかぎ', 'にちりん', 'ソニック', 'かもめ', 'みどり', 'ハウステンボス', 'ゆふ', 'きりしま',
              'しおかぜ', 'いしづち', '南風', 'うずしお')
# 小田急ロマンスカーの愛称（名前がこれだけの路線は外す。「えのしま」は地名でもあるので、名前全体が同じときだけ）
ROMANCECAR = ('えのしま', 'さがみ', 'はこね', 'スーパーはこね', 'メトロはこね', 'メトロえのしま', 'メトロさがみ', 'モーニングウェイ',
              'ホームウェイ', 'メトロモーニングウェイ', 'メトロホームウェイ', 'ふじさん')
NOT_PAID = ('サザン',)             # 自由席の車両は料金が要らない
# 新幹線の列車の名前（名前に「新幹線」の付かない relation がある。名前全体が同じときだけ外す）
SHINKANSEN = ('のぞみ', 'ひかり', 'こだま', 'みずほ', 'さくら', 'つばめ', 'はやぶさ', 'はやて', 'やまびこ', 'なすの', 'こまち', 'つばさ',
              'とき', 'たにがわ', 'かがやき', 'はくたか', 'あさま', 'つるぎ', 'ひかりレールスター',
              'nozomi', 'hikari', 'kodama', 'mizuho', 'sakura', 'tsubame', 'hayabusa', 'hayate', 'yamabiko', 'nasuno', 'komachi',
              'tsubasa', 'toki', 'tanigawa', 'kagayaki', 'hakutaka', 'asama', 'tsurugi')
BORROW_MIN = 3                     # 色の無い路線が、色のある路線から色を借りるのに要る同じ駅の数
SAME_STATION_M = 250               # 名前が同じで、この距離より近い駅を同じ駅とみなす（尼崎・芦屋など、会社ごとに別の駅がある）
PAID_EXPRESS = ('JR', '旅客鉄道', '近畿日本鉄道', '近鉄', '東武', '西武', '小田急', '南海', 'Kintetsu', 'Tobu', 'Seibu', 'Odakyu', 'Nankai')


def enabled():
    return os.environ.get('ZT_RAIL', '1').strip() != '0'


class Busy(Exception):
    """Overpass が込んでいる・時間切れ（しばらく聞かない）"""


# ---- 1 本の路線 ----
def clean_name(s):
    """終わりの「 (A => B)」の括弧を外す"""
    t = bus.nfkc(s)
    t = re.sub(r'\s*[(（][^()（）]*(=>|⇒|→|->)[^()（）]*[)）]\s*$', '', t)
    t = re.sub(r'\s*[:：][^:：]*(=>|⇒|→|->)[^:：]*$', '', t)
    return t.strip()


# CSS の色の名前（colour タグに「darkgreen」のように名前で書いてある路線がある）
CSS_COLOURS = {
    'aliceblue': 'F0F8FF', 'antiquewhite': 'FAEBD7', 'aqua': '00FFFF', 'aquamarine': '7FFFD4', 'azure': 'F0FFFF',
    'beige': 'F5F5DC', 'bisque': 'FFE4C4', 'black': '000000', 'blanchedalmond': 'FFEBCD', 'blue': '0000FF',
    'blueviolet': '8A2BE2', 'brown': 'A52A2A', 'burlywood': 'DEB887', 'cadetblue': '5F9EA0', 'chartreuse': '7FFF00',
    'chocolate': 'D2691E', 'coral': 'FF7F50', 'cornflowerblue': '6495ED', 'cornsilk': 'FFF8DC', 'crimson': 'DC143C',
    'cyan': '00FFFF', 'darkblue': '00008B', 'darkcyan': '008B8B', 'darkgoldenrod': 'B8860B', 'darkgray': 'A9A9A9',
    'darkgreen': '006400', 'darkgrey': 'A9A9A9', 'darkkhaki': 'BDB76B', 'darkmagenta': '8B008B', 'darkolivegreen': '556B2F',
    'darkorange': 'FF8C00', 'darkorchid': '9932CC', 'darkred': '8B0000', 'darksalmon': 'E9967A', 'darkseagreen': '8FBC8F',
    'darkslateblue': '483D8B', 'darkslategray': '2F4F4F', 'darkslategrey': '2F4F4F', 'darkturquoise': '00CED1',
    'darkviolet': '9400D3', 'deeppink': 'FF1493', 'deepskyblue': '00BFFF', 'dimgray': '696969', 'dimgrey': '696969',
    'dodgerblue': '1E90FF', 'firebrick': 'B22222', 'floralwhite': 'FFFAF0', 'forestgreen': '228B22', 'fuchsia': 'FF00FF',
    'gainsboro': 'DCDCDC', 'ghostwhite': 'F8F8FF', 'gold': 'FFD700', 'goldenrod': 'DAA520', 'gray': '808080',
    'green': '008000', 'greenyellow': 'ADFF2F', 'grey': '808080', 'honeydew': 'F0FFF0', 'hotpink': 'FF69B4',
    'indianred': 'CD5C5C', 'indigo': '4B0082', 'ivory': 'FFFFF0', 'khaki': 'F0E68C', 'lavender': 'E6E6FA',
    'lavenderblush': 'FFF0F5', 'lawngreen': '7CFC00', 'lemonchiffon': 'FFFACD', 'lightblue': 'ADD8E6', 'lightcoral': 'F08080',
    'lightcyan': 'E0FFFF', 'lightgoldenrodyellow': 'FAFAD2', 'lightgray': 'D3D3D3', 'lightgreen': '90EE90',
    'lightgrey': 'D3D3D3', 'lightpink': 'FFB6C1', 'lightsalmon': 'FFA07A', 'lightseagreen': '20B2AA', 'lightskyblue': '87CEFA',
    'lightslategray': '778899', 'lightslategrey': '778899', 'lightsteelblue': 'B0C4DE', 'lightyellow': 'FFFFE0',
    'lime': '00FF00', 'limegreen': '32CD32', 'linen': 'FAF0E6', 'magenta': 'FF00FF', 'maroon': '800000',
    'mediumaquamarine': '66CDAA', 'mediumblue': '0000CD', 'mediumorchid': 'BA55D3', 'mediumpurple': '9370DB',
    'mediumseagreen': '3CB371', 'mediumslateblue': '7B68EE', 'mediumspringgreen': '00FA9A', 'mediumturquoise': '48D1CC',
    'mediumvioletred': 'C71585', 'midnightblue': '191970', 'mintcream': 'F5FFFA', 'mistyrose': 'FFE4E1', 'moccasin': 'FFE4B5',
    'navajowhite': 'FFDEAD', 'navy': '000080', 'oldlace': 'FDF5E6', 'olive': '808000', 'olivedrab': '6B8E23',
    'orange': 'FFA500', 'orangered': 'FF4500', 'orchid': 'DA70D6', 'palegoldenrod': 'EEE8AA', 'palegreen': '98FB98',
    'paleturquoise': 'AFEEEE', 'palevioletred': 'DB7093', 'papayawhip': 'FFEFD5', 'peachpuff': 'FFDAB9', 'peru': 'CD853F',
    'pink': 'FFC0CB', 'plum': 'DDA0DD', 'powderblue': 'B0E0E6', 'purple': '800080', 'rebeccapurple': '663399', 'red': 'FF0000',
    'rosybrown': 'BC8F8F', 'royalblue': '4169E1', 'saddlebrown': '8B4513', 'salmon': 'FA8072', 'sandybrown': 'F4A460',
    'seagreen': '2E8B57', 'seashell': 'FFF5EE', 'sienna': 'A0522D', 'silver': 'C0C0C0', 'skyblue': '87CEEB',
    'slateblue': '6A5ACD', 'slategray': '708090', 'slategrey': '708090', 'snow': 'FFFAFA', 'springgreen': '00FF7F',
    'steelblue': '4682B4', 'tan': 'D2B48C', 'teal': '008080', 'thistle': 'D8BFD8', 'tomato': 'FF6347', 'turquoise': '40E0D0',
    'violet': 'EE82EE', 'wheat': 'F5DEB3', 'white': 'FFFFFF', 'whitesmoke': 'F5F5F5', 'yellow': 'FFFF00',
    'yellowgreen': '9ACD32'
}


def colour_of(v):
    v = (v or '').strip()
    v = CSS_COLOURS.get(v.lower().replace(' ', ''), v).lstrip('#')
    if re.fullmatch(r'[0-9A-Fa-f]{3}', v):
        v = ''.join(c * 2 for c in v)
    return v.upper() if re.fullmatch(r'[0-9A-Fa-f]{6}', v) else None


def interval_of(v):
    """interval タグ（分か HH:MM・HH:MM:SS）→ 分。読めなければ None"""
    v = (v or '').strip()
    if re.fullmatch(r'\d{1,3}', v):
        return int(v)
    m = re.fullmatch(r'(\d{1,2}):(\d{2})(?::\d{2})?', v)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def wait_of(tags, mode):
    iv = interval_of(tags.get('interval'))
    if iv:
        return max(2, min(15, round(iv / 2)))
    return WAIT.get(mode, 5)


def unwanted(tags):
    """使わない路線（新幹線・寝台・夜行・別の料金が要る特急）"""
    if (tags.get('service') or '').strip() in ('high_speed', 'long_distance', 'night'):
        return True
    names = ' '.join(bus.nfkc(tags.get(k)) for k in ('name', 'name:en'))
    low = names.lower()
    if any(w in low for w in NOT_FOR_US) or any(w in low for w in PAID_NAMES):
        return True
    if any(w in names for w in NOT_PAID):
        return False
    who = ' '.join(bus.nfkc(tags.get(k)) for k in ('operator', 'network', 'name', 'name:en'))
    if ('特急' in names or 'limited express' in low) and any(w in who for w in PAID_EXPRESS):
        return True
    jr = 'JR' in who or '旅客鉄道' in who
    name = clean_name(tags.get('name'))
    bare = re.sub(r'^JR\s*', '', bus.nfkc(name).replace('特急', '')).strip()
    if bare in ROMANCECAR or bare.lower() in SHINKANSEN or clean_name(tags.get('name:en')).lower() in SHINKANSEN:
        return True
    express = any(bare.startswith(w) for w in JR_EXPRESS)
    if jr:
        return express
    # 運行会社も路線網も書いていない路線は、名前が特急の愛称そのもの（「〜線」でない）なら外す
    unknown = not (bus.nfkc(tags.get('operator')) or bus.nfkc(tags.get('network')))
    return unknown and express and not re.search(r'(線|line)$', name, re.I)


def segment_min(mode, km):
    dwell, steps, top = SPEED['subway' if mode == 'subway' else 'tram' if mode == 'tram' else 'train']
    v = top
    for limit, speed in steps:
        if km < limit:
            v = speed
            break
    return dwell + km / v * 60


class Line:
    __slots__ = ('rid', 'name', 'name_en', 'color', 'mode', 'wait', 'lat', 'lng', 'names', 'names_en', 'cum', 'operator')

    def __init__(self, rid, tags, stops, operator=''):
        self.rid = rid
        self.operator = operator
        self.name = clean_name(tags.get('name')) or clean_name(tags.get('ref'))
        self.name_en = clean_name(tags.get('name:en')) or self.name
        self.color = colour_of(tags.get('colour'))
        self.mode = tags.get('route')
        self.wait = wait_of(tags, self.mode)
        self.lat = [s[0] for s in stops]
        self.lng = [s[1] for s in stops]
        self.names = [s[2] for s in stops]
        self.names_en = [s[3] or s[2] for s in stops]
        cum = [0.0]
        for k in range(1, len(stops)):
            km = bus.dist_m(self.lat[k - 1], self.lng[k - 1], self.lat[k], self.lng[k]) * STRAIGHT / 1000
            cum.append(cum[-1] + segment_min(self.mode, km))
        self.cum = cum

    def ride(self, k, l):
        return abs(self.cum[l] - self.cum[k])


def lines_of(raw):
    """作り置きの形（{rels, nodes}）→ Line の並び"""
    nodes = raw.get('nodes') or {}
    out = []
    for r in raw.get('rels') or []:
        tags = r.get('tags') or {}
        if tags.get('route') not in MODES or unwanted(tags):
            continue
        members = r.get('members') or []
        roles = STOP_ROLES if any(role in STOP_ROLES for _, role in members) else PLATFORM_ROLES
        stops = []
        for ref, role in members:
            if role not in roles:
                continue
            nd = nodes.get(str(ref))
            if not nd:
                continue
            lat, lng, name, name_en = nd
            name = clean_name(name)
            if not name:
                continue
            if stops and stops[-1][2] == name:
                continue
            stops.append((lat, lng, name, clean_name(name_en)))
        if len(stops) < 2:
            continue
        out.append(Line(r.get('id'), tags, stops, bus.nfkc(tags.get('operator'))))
    borrow_colours(out)
    return out


def borrow_colours(lines):
    """色の無い路線に、同じ駅を BORROW_MIN 以上通る色のある路線（運行会社が分かれば同じ会社）の色を付ける。
    急行・直通の運行の relation には色が無く、同じ線路の各駅停車にはある、ということが多い"""
    coloured = [(l, {nm: (l.lat[k], l.lng[k]) for k, nm in enumerate(l.names)}) for l in lines if l.color]
    for l in lines:
        if l.color:
            continue
        best, most = None, BORROW_MIN - 1
        for c, at in coloured:
            if l.operator and c.operator and l.operator != c.operator:
                continue
            n = sum(1 for k, nm in enumerate(l.names)
                    if nm in at and bus.dist_m(l.lat[k], l.lng[k], *at[nm]) <= SAME_STATION_M)
            if n > most:
                best, most = c, n
        if best is not None:
            l.color = best.color


def compact(answer):
    """Overpass の返事 → 作り置きの形（使う物だけ）"""
    rels, nodes = [], {}
    for el in answer.get('elements') or []:
        t = el.get('tags') or {}
        if el.get('type') == 'relation':
            members = [[m.get('ref'), m.get('role') or ''] for m in el.get('members') or []
                       if m.get('type') == 'node' and (m.get('role') in STOP_ROLES or m.get('role') in PLATFORM_ROLES)]
            rels.append({'id': el.get('id'), 'tags': {k: t[k] for k in TAGS if t.get(k)}, 'members': members})
        elif el.get('type') == 'node' and 'lat' in el and 'lon' in el:
            nodes[str(el['id'])] = [round(el['lat'], 6), round(el['lon'], 6), t.get('name') or '', t.get('name:en') or '']
    return {'rels': rels, 'nodes': nodes}


# ---- 範囲の路線のまとまり ----
class Network:
    def __init__(self, lines, fetched=0.0):
        self.lines = lines
        self.fetched = fetched
        self.grid = {}
        for li, ln in enumerate(lines):
            for k in range(len(ln.lat)):
                self.grid.setdefault((math.floor(ln.lat[k] / CELL), math.floor(ln.lng[k] / CELL)), []).append((li, k))

    def version(self):
        return f'{int(self.fetched)}'

    def near(self, lat, lng, radius=None):
        """地点から直線 radius m 以内の駅 → {路線の番号: [(駅の番号, 歩く分)]}"""
        radius = bus.NEAR_M if radius is None else radius
        dl = radius / 111320
        dg = dl / max(0.1, math.cos(math.radians(lat)))
        out = {}
        for ci in range(math.floor((lat - dl) / CELL), math.floor((lat + dl) / CELL) + 1):
            for cj in range(math.floor((lng - dg) / CELL), math.floor((lng + dg) / CELL) + 1):
                for li, k in self.grid.get((ci, cj), ()):
                    ln = self.lines[li]
                    d = bus.dist_m(lat, lng, ln.lat[k], ln.lng[k])
                    if d <= radius:
                        out.setdefault(li, []).append((k, bus.walk_min(d)))
        return out

    def has_lines(self, box):
        """範囲に駅が 2 つ以上ある路線があるか"""
        s, w, n, e = box
        for ln in self.lines:
            c = sum(1 for la, lo in zip(ln.lat, ln.lng) if s <= la <= n and w <= lo <= e)
            if c >= 2:
                return True
        return False

    def best(self, points):
        """points の組み (i, j) ごとに、いちばん短い (合計, 路線, 乗る駅, 降りる駅, 歩く, 待つ, 乗る, 歩く) か None"""
        near = [self.near(*p) for p in points]
        n = len(points)
        out = [[None] * n for _ in range(n)]
        for i in range(n):
            if not near[i]:
                continue
            for j in range(n):
                if i == j or not near[j] or bus.dist_m(*points[i], *points[j]) < MIN_PAIR_M:
                    continue
                a, b = near[i], near[j]
                top = None
                for li in (a.keys() & b.keys()):
                    ln = self.lines[li]
                    for k, wt in a[li]:
                        for l, wf in b[li]:
                            if k == l or ln.names[k] == ln.names[l]:
                                continue
                            ride = max(1, round(ln.ride(k, l)))
                            total = wt + ln.wait + ride + wf
                            key = (total, wt + wf, ride)
                            if top is None or key < top[0]:
                                top = (key, (total, li, k, l, wt, ln.wait, ride, wf))
                if top:
                    out[i][j] = top[1]
        return out

    def opt(self, choice, lang='ja'):
        total, li, k, l, wt, wait, ride, wf = choice
        ln = self.lines[li]
        en = lang == 'en'
        names = ln.names_en if en else ln.names
        step = 1 if l > k else -1
        return {'line': ln.name_en if en else ln.name, 'color': ln.color, 'mode': ln.mode,
                'board': {'name': names[k], 'lat': round(ln.lat[k], 5), 'lng': round(ln.lng[k], 5)},
                'alight': {'name': names[l], 'lat': round(ln.lat[l], 5), 'lng': round(ln.lng[l], 5)},
                'walkTo': wt, 'wait': wait, 'ride': ride, 'walkFrom': wf, 'stops': abs(l - k),
                'path': [[round(ln.lng[x], 5), round(ln.lat[x], 5)] for x in range(k, l + step, step)]}


EMPTY = Network([], 0.0)


def merge(bus_minutes, choices, net, lang='ja'):
    """時刻表の目安（無ければ None）と電車の目安を合わせる → (minutes, rail か None)。
    時刻表の値がある組みはそのまま。無い組みだけ電車の目安を使い、via に opts の番号を入れる"""
    n = len(choices)
    minutes = [[None] * n for _ in range(n)]
    via = [[None] * n for _ in range(n)]
    opts, seen = [], {}
    for i in range(n):
        for j in range(n):
            v = bus_minutes[i][j] if bus_minutes else None
            if v is not None:
                minutes[i][j] = v
                continue
            c = choices[i][j]
            if c is None or net is None:
                continue
            o = net.opt(c, lang)
            k = json.dumps(o, sort_keys=True, ensure_ascii=False)
            if k not in seen:
                seen[k] = len(opts)
                opts.append(o)
            via[i][j] = seen[k]
            minutes[i][j] = c[0]
    return minutes, ({'opts': opts, 'via': via} if opts else None)


# ---- Overpass に聞く ----
def overpass(box, timeout=TIMEOUT):
    s, w, n, e = box
    q = QUERY.format(s=f'{s:.4f}', w=f'{w:.4f}', n=f'{n:.4f}', e=f'{e:.4f}')
    req = urllib.request.Request(URL, data=urllib.parse.urlencode({'data': q}).encode(),
                                 headers={'User-Agent': UA, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as ex:
        if ex.code in (429, 502, 503, 504):
            raise Busy(f'HTTP {ex.code}') from None
        raise
    except (socket.timeout, TimeoutError) as ex:
        raise Busy('timeout') from ex
    except urllib.error.URLError as ex:
        if isinstance(ex.reason, (socket.timeout, TimeoutError)):
            raise Busy('timeout') from ex
        raise
    if len(body) > MAX_BYTES:
        raise ValueError('too large')
    answer = json.loads(body)
    remark = str(answer.get('remark') or '')
    if 'timed out' in remark or 'out of memory' in remark or 'rate_limited' in remark:
        raise Busy(remark[:80])
    if remark:
        raise ValueError(remark[:80])
    return answer


def key_box(points):
    return bus_feeds.snap(bus_feeds.clip(bus.area_box(points)))


def box_name(box):
    return '_'.join(f'{x:.2f}' for x in box) + '.json'


BOX_FILE = re.compile(r'^(-?\d+\.\d{2})_(-?\d+\.\d{2})_(-?\d+\.\d{2})_(-?\d+\.\d{2})\.json$')
_NET = threading.Lock()            # Overpass に聞くのは全体で 1 度に 1 つ


class Store:
    """範囲ごとの路線のまとまり。get(points) → (Network か None, 'ready'・'pending'・'none'・'off')"""

    def __init__(self, cache_dir, fetch=None, now=time.time, sleep=time.sleep, on=enabled):
        self.dir = cache_dir
        self.fetch = fetch or overpass
        self.now, self.sleep, self.on = now, sleep, on
        self.lock = threading.Lock()
        self.cv = threading.Condition(self.lock)
        self.mem = collections.OrderedDict()   # 範囲 → Network
        self.busy = set()                      # 取っている・取る順番を待っている範囲
        self.queue = collections.deque()
        self.failed = {}                       # 範囲 → もう一度聞いてよい時刻
        self.asked = collections.deque()       # 聞いた時刻（1 日の数を数える）
        self.last = 0.0
        self.worker = None

    def enabled(self):
        return bool(self.on())

    # -- 作り置き --
    def _read(self, box):
        try:
            with open(os.path.join(self.dir, box_name(box)), encoding='utf-8') as f:
                d = json.load(f)
        except (OSError, ValueError):
            return None
        if d.get('format') != FORMAT:
            return None
        try:
            return Network(lines_of(d), float(d.get('fetched') or 0))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return None

    def _write(self, box, raw, fetched):
        try:
            os.makedirs(self.dir, exist_ok=True)
            path = os.path.join(self.dir, box_name(box))
            tmp = path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({'format': FORMAT, 'fetched': fetched, 'box': list(box), **raw}, f, ensure_ascii=False, separators=(',', ':'))
            os.replace(tmp, path)
            self._prune()
        except OSError:
            traceback.print_exc()

    def _prune(self):
        try:
            files = [os.path.join(self.dir, f) for f in os.listdir(self.dir) if BOX_FILE.match(f)]
        except OSError:
            return
        if len(files) <= DISK_FILES:
            return
        files.sort(key=lambda p: os.path.getmtime(p))
        for p in files[:len(files) - DISK_FILES]:
            try:
                os.remove(p)
            except OSError:
                pass

    def _on_disk(self, box):
        """box を含む作り置きの範囲（狭い順）"""
        try:
            names = os.listdir(self.dir)
        except OSError:
            return []
        out = []
        for f in names:
            m = BOX_FILE.match(f)
            if not m:
                continue
            b = tuple(float(x) for x in m.groups())
            if bus_feeds.contains(b, box):
                out.append(b)
        out.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        return out

    def _remember(self, box, net):
        self.mem[box] = net
        self.mem.move_to_end(box)
        while len(self.mem) > MEM_KEEP:
            self.mem.popitem(last=False)

    def _cached(self, box):
        """box を含む範囲の Network（メモリ → ディスク）。(Network, その範囲) か (None, None)"""
        for b in sorted((b for b in self.mem if bus_feeds.contains(b, box)), key=lambda b: (b[2] - b[0]) * (b[3] - b[1])):
            self.mem.move_to_end(b)
            return self.mem[b], b
        for b in self._on_disk(box):
            net = self._read(b)
            if net is not None:
                self._remember(b, net)
                return net, b
        return None, None

    # -- 取る --
    def _enqueue(self, box):
        if any(bus_feeds.contains(b, box) for b in self.busy):
            return True
        if len(self.queue) >= QUEUE_MAX:
            return False
        if self.failed.get(box, 0) > self.now():
            return False
        self.busy.add(box)
        self.queue.append(box)
        if self.worker is None or not self.worker.is_alive():
            self.worker = threading.Thread(target=self._work, daemon=True)
            self.worker.start()
        self.cv.notify_all()
        return True

    def _work(self):
        while True:
            with self.cv:
                if not self.queue:
                    self.cv.wait(timeout=60)
                    if not self.queue:
                        self.worker = None
                        return
                box = self.queue.popleft()
            try:
                self._obtain(box)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                with self.lock:
                    self.failed[box] = self.now() + RETRY_AFTER
            finally:
                with self.lock:
                    self.busy.discard(box)

    def _obtain(self, box):
        with _NET:
            with self.lock:
                now = self.now()
                have, _ = self._cached(box)
                if have is not None and now - have.fetched <= REFRESH:
                    return
                while self.asked and now - self.asked[0] > 86400:
                    self.asked.popleft()
                if PER_DAY > 0 and len(self.asked) >= PER_DAY:
                    self.failed[box] = now + RETRY_AFTER
                    return
                gap = self.last + GAP - now
            if gap > 0:
                self.sleep(gap)
            with self.lock:
                self.asked.append(self.now())
            try:
                answer = self.fetch(box)
            except Busy as ex:
                print(f'rail: Overpass {ex} {box}', flush=True)
                with self.lock:
                    self.failed[box] = self.now() + RETRY_AFTER
                return
            except Exception as ex:  # noqa: BLE001
                print(f'rail: Overpass failed {type(ex).__name__} {box}', flush=True)
                with self.lock:
                    self.failed[box] = self.now() + RETRY_AFTER
                return
            finally:
                with self.lock:
                    self.last = self.now()
        raw = compact(answer)
        fetched = self.now()
        net = Network(lines_of(raw), fetched)
        self._write(box, raw, fetched)
        with self.lock:
            self._remember(box, net)
            self.failed.pop(box, None)

    def get_box(self, box):
        if not self.enabled():
            return None, 'off'
        with self.lock:
            net, found = self._cached(box)
            if net is not None:
                if self.now() - net.fetched > REFRESH:
                    self._enqueue(found)
                return net, 'ready'
            if self._enqueue(box):
                return None, 'pending'
            return None, 'none'

    def get(self, points):
        return self.get_box(key_box(points))
