# 歩く道の上り下り（国土地理院の標高タイル。日本だけ）。
# 地理院タイルは、アプリでその場で読み込んで使うなら出典を出すだけで使える（申請は要らない）。
# そのためタイルはメモリの中にだけ置き、ファイルには道ごとの上り下りの数字だけを取っておく。
# 決まった回数の上限は無いが「サーバに過度の負担を与えない」決まりなので、1 枚ずつ間をあけて取り、1 時間あたりの枚数にも上限を設ける。
# 5 m メッシュ（DEM5A。航空レーザーで測った地面の高さ）を使い、無い所は 10 m メッシュ（DEM10B。全国）で補う。
import math, struct, threading, time, urllib.error, urllib.request, zlib
from collections import OrderedDict

import places

UA = places.UA
URL = 'https://cyberjapandata.gsi.go.jp/xyz/{name}/{z}/{x}/{y}.png'
LAYERS = (('dem5a_png', 15), ('dem_png', 14))
GAP = 0.2                                       # タイルを取る間隔（秒）
PER_HOUR = 1500                                 # 1 時間に取るタイルの枚数の上限（全体）
KEEP = 96                                       # メモリに置いておくタイルの枚数
STEP = 10.0                                     # 道の上で高さを見る間隔（m）
MAX_LEN = 8000.0                                # これより長い道は見ない（m）
HYST = 2.0                                      # 上り下りに数える、高さの変わりの最小（m。測り方の揺れを数えない）
STEEP_RUN = 80.0                                # 急な坂を見る長さ（m）
STEEP_RISE = 8.0                                # その長さで、これだけ上る・下ると急な坂（10%）
JAPAN = (20.0, 122.0, 46.5, 154.5)              # 南・西・北・東

_lock = threading.Lock()
_last = [0.0]
_hits = []
_tiles = OrderedDict()                          # (名前, z, x, y) → 高さの並び（無いタイルは b''）


class Busy(Exception):
    """問い合わせに失敗した・上限に届いた（あとでもう一度）"""


def decode(data):
    """地理院の標高タイルの PNG → 256×256 の高さ（m。無い所は None）"""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    pos, idat, w = 8, [], 0
    while pos + 8 <= len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, depth, color, _, _, lace = struct.unpack('>IIBBBBB', body)
            if (w, h, depth, color, lace) != (256, 256, 8, 2, 0):
                return None
        elif kind == b'IDAT':
            idat.append(body)
        elif kind == b'IEND':
            break
        pos += 12 + n
    raw = zlib.decompress(b''.join(idat))
    stride = 256 * 3
    prev = bytearray(stride)
    out = [None] * (256 * 256)
    for y in range(256):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(3, stride):
                line[i] = (line[i] + line[i - 3]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                line[i] = (line[i] + ((line[i - 3] if i >= 3 else 0) + prev[i]) // 2) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - 3] if i >= 3 else 0
                b = prev[i]
                c = prev[i - 3] if i >= 3 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        for x in range(256):
            v = (line[3 * x] << 16) | (line[3 * x + 1] << 8) | line[3 * x + 2]
            if v != 0x800000:
                out[y * 256 + x] = (v - 0x1000000 if v > 0x800000 else v) * 0.01
        prev = line
    return out


def tile(name, z, x, y):
    """タイル 1 枚（無いタイルは b''）。取れなかったら Busy"""
    k = (name, z, x, y)
    with _lock:
        if k in _tiles:
            _tiles.move_to_end(k)
            return _tiles[k]
        now = time.time()
        _hits[:] = [t for t in _hits if now - t < 3600]
        if len(_hits) >= PER_HOUR:
            raise Busy()
        wait = GAP - (now - _last[0])
        if wait > 0:
            time.sleep(wait)
        _hits.append(time.time())
        try:
            req = urllib.request.Request(URL.format(name=name, z=z, x=x, y=y), headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=15) as r:
                got = decode(r.read()) or b''
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise Busy()
            got = b''
        except Exception:
            raise Busy()
        finally:
            _last[0] = time.time()
        _tiles[k] = got
        while len(_tiles) > KEEP:
            _tiles.popitem(last=False)
        return got


def _pixel(name, z, gx, gy):
    t = tile(name, z, gx // 256, gy // 256)
    return t[(gy % 256) * 256 + gx % 256] if t else None


def height(lng, lat):
    """その地点の地面の高さ（m）。無ければ None"""
    for name, z in LAYERS:
        n = 256 * 2 ** z
        px = (lng + 180) / 360 * n - 0.5
        py = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n - 0.5
        x0, y0 = math.floor(px), math.floor(py)
        fx, fy = px - x0, py - y0
        v = [_pixel(name, z, x0 + dx, y0 + dy) for dy in (0, 1) for dx in (0, 1)]
        if None not in v:
            top = v[0] * (1 - fx) + v[1] * fx
            bottom = v[2] * (1 - fx) + v[3] * fx
            return top * (1 - fy) + bottom * fy
    return None


def in_japan(lng, lat):
    s, w, n, e = JAPAN
    return s <= lat <= n and w <= lng <= e


def heights(points):
    """[{lat, lng}] → 地点ごとの地面の高さ（m。日本の外・データが無い所は None）。取れなかったら Busy"""
    out = []
    for p in points:
        h = height(p['lng'], p['lat']) if in_japan(p['lng'], p['lat']) else None
        out.append(None if h is None else round(h, 1))
    return out


def _dist(a, b):
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320


def resample(line, step=STEP):
    """道の線（[経度, 緯度] の並び）の上に step m おきの点"""
    out = [line[0]]
    left = step
    for a, b in zip(line, line[1:]):
        d = _dist(a, b)
        pos = 0.0
        while d - pos >= left:
            pos += left
            f = pos / d
            out.append([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
            left = step
        left -= d - pos
    if _dist(out[-1], line[-1]) > 1.0:
        out.append(line[-1])
    return out


def summary(hs, step=STEP):
    """step m おきの高さ → 上り・下り（m）と急な坂があるか"""
    sm = [sum(hs[max(0, i - 1):i + 2]) / len(hs[max(0, i - 1):i + 2]) for i in range(len(hs))]
    up = down = 0.0
    ref = sm[0]
    for h in sm[1:]:
        if h - ref >= HYST:
            up, ref = up + h - ref, h
        elif ref - h >= HYST:
            down, ref = down + ref - h, h
    run = max(1, round(STEEP_RUN / step))
    rises = [sm[i + run] - sm[i] for i in range(len(sm) - run)]
    return {'up': round(up), 'down': round(down),
            'steepUp': any(r >= STEEP_RISE for r in rises), 'steepDown': any(r <= -STEEP_RISE for r in rises),
            'm': round((len(hs) - 1) * step)}


def slope(line):
    """道の線 → 上り下りのまとめ。データが無い所（日本の外・海など）は {}。取れなかったら Busy"""
    if not line or len(line) < 2:
        return {}
    if not all(in_japan(x, y) for x, y in line):
        return {}
    if sum(_dist(a, b) for a, b in zip(line, line[1:])) > MAX_LEN:
        return {}
    pts = resample(line)
    if len(pts) < 3:
        return {'up': 0, 'down': 0, 'steepUp': False, 'steepDown': False, 'm': round(_dist(line[0], line[-1]))}
    hs = [height(x, y) for x, y in pts]
    got = [h for h in hs if h is not None]
    if len(got) < len(hs) * 0.9:
        return {}
    last = got[0]
    for i, h in enumerate(hs):              # 高さの無い点（少しだけ）は、前の点の高さで埋める
        if h is None:
            hs[i] = last
        else:
            last = h
    return summary(hs)
