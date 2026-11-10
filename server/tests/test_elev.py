# elev.py（歩く道の上り下り）の試験。cd server && python3 -m unittest discover -s tests
import os, random, struct, sys, unittest, zlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import elev  # noqa: E402


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def png(heights):
    """256×256 の高さ（m。None は無効）→ 地理院の標高タイルと同じ形の PNG。行ごとに 5 つのフィルターを順に使う"""
    rows = []
    for y in range(256):
        line = bytearray()
        for x in range(256):
            h = heights[y * 256 + x]
            v = 0x800000 if h is None else round(h * 100) & 0xFFFFFF
            line += bytes(((v >> 16) & 255, (v >> 8) & 255, v & 255))
        rows.append(line)
    raw = bytearray()
    prev = bytearray(256 * 3)
    for y, line in enumerate(rows):
        f = y % 5
        out = bytearray()
        for i in range(len(line)):
            a = line[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            pred = (0, a, b, (a + b) // 2, paeth(a, b, c))[f]
            out.append((line[i] - pred) & 255)
        raw += bytes((f,)) + out
        prev = line
    chunk = lambda k, d: struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d) & 0xFFFFFFFF)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 256, 256, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw))) + chunk(b'IEND', b''))


class DecodeTest(unittest.TestCase):
    def test_round_trip(self):
        rnd = random.Random(1)
        hs = [round(rnd.uniform(-5, 900), 2) for _ in range(256 * 256)]
        hs[0] = None
        hs[300] = -3.21
        got = elev.decode(png(hs))
        self.assertIsNone(got[0])
        self.assertAlmostEqual(got[300], -3.21)
        self.assertTrue(all(g is None if h is None else abs(g - h) < 1e-6 for g, h in zip(got, hs)))

    def test_not_png(self):
        self.assertIsNone(elev.decode(b'<html>'))


class SummaryTest(unittest.TestCase):
    def test_flat_with_noise(self):
        rnd = random.Random(2)
        s = elev.summary([30 + rnd.uniform(-0.8, 0.8) for _ in range(200)])
        self.assertEqual((s['up'], s['down'], s['steepUp'], s['steepDown']), (0, 0, False, False))

    def test_hill(self):
        s = elev.summary([10 + min(i, 40) * 1.2 for i in range(100)])   # 400 m で 48 m 上る（12%）
        self.assertGreaterEqual(s['up'], 44)
        self.assertTrue(s['steepUp'])
        self.assertFalse(s['steepDown'])
        self.assertEqual(s['m'], 990)

    def test_gentle_long_slope_is_not_steep(self):
        s = elev.summary([50 - i * 0.05 for i in range(300)])            # 3 km で 15 m 下る（0.5%）
        self.assertFalse(s['steepDown'])
        self.assertLessEqual(s['up'], 2)

    def test_small_dip_is_not_steep(self):
        hs = [20.0] * 30 + [17.0, 15.0, 15.0, 17.0] + [20.0] * 30       # 橋の下の川のような 5 m のくぼみ
        s = elev.summary(hs)
        self.assertFalse(s['steepUp'] or s['steepDown'])


class SlopeTest(unittest.TestCase):
    def test_outside_japan_asks_nothing(self):
        called = []
        real = elev.tile
        elev.tile = lambda *a: called.append(a)
        try:
            self.assertEqual(elev.slope([[-0.1, 51.5], [-0.11, 51.51]]), {})
        finally:
            elev.tile = real
        self.assertEqual(called, [])

    def test_heights_outside_japan(self):
        real = elev.height
        elev.height = lambda x, y: 12.345
        try:
            self.assertEqual(elev.heights([{'lat': 35.0, 'lng': 135.0}, {'lat': 51.5, 'lng': -0.1}]), [12.3, None])
        finally:
            elev.height = real

    def test_missing_heights_give_nothing(self):
        real = elev.height
        elev.height = lambda x, y: None
        try:
            self.assertEqual(elev.slope([[135.0, 35.0], [135.01, 35.0]]), {})
        finally:
            elev.height = real

    def test_resample_spacing(self):
        pts = elev.resample([[135.0, 35.0], [135.01, 35.0]])
        d = [elev._dist(a, b) for a, b in zip(pts, pts[1:])]
        self.assertTrue(all(abs(x - elev.STEP) < 0.5 for x in d[:-1]))
        self.assertEqual(pts[-1], [135.01, 35.0])


if __name__ == '__main__':
    unittest.main()
