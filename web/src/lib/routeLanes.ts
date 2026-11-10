// 同じ道を通る区間の線を、少しずつ横にずらす（路線図のように並べて、どの区間の線か見分けられるようにする）。
// 区間どうしで、同じ向きか逆向きに同じ道を通る所（道のりで MIN_SHARED 以上）を探し、重なる区間にだけ車線を割り当てる。
// 車線は 0（ずらさない）・±0.5・±1.5……で、正は進む向きの右。幅は地図の拡大に合わせる（拡大するほど広い）
import type { LL } from '../components/mapShared'

const NEAR = 14 // m: この距離より近い所を、同じ道とみなす
const STEP = 20 // m: 線の上を調べる間隔
const MIN_SHARED = 80 // m
const PARALLEL = 0.85 // 向きの cos がこれより大きければ、同じ向きか逆向きに並んでいる

// 車線 1 つの幅（px）。[拡大, 幅] の間を線でつなぐ（MapLibre の式と同じ点）
export const LANE_STOPS: [number, number][] = [
  [12, 4],
  [16, 6.5],
]

export function laneGap(zoom: number): number {
  const [[z0, w0], [z1, w1]] = LANE_STOPS
  const f = Math.min(1, Math.max(0, (zoom - z0) / (z1 - z0)))
  return w0 + (w1 - w0) * f
}

type XY = [number, number]
const M_PER_DEG = 111320

function toXY(c: LL[], lat0: number): XY[] {
  const k = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG
  return c.map(([lng, lat]) => [lng * k, lat * M_PER_DEG])
}

// 線の上を STEP ごとに見た点と、その所の向き（長さ 1）
function samples(line: XY[]): { p: XY; d: XY }[] {
  const out: { p: XY; d: XY }[] = []
  let rest = 0
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]
    const dx = line[i][0] - ax
    const dy = line[i][1] - ay
    const len = Math.hypot(dx, dy)
    if (!len) continue
    const d: XY = [dx / len, dy / len]
    let t = rest
    for (; t < len; t += STEP) out.push({ p: [ax + d[0] * t, ay + d[1] * t], d })
    rest = t - len
  }
  return out
}

type Box = [number, number, number, number]
const boxOf = (l: XY[]): Box => {
  let b: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of l) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]
  return b
}
const inBox = ([x, y]: XY, b: Box) => x >= b[0] - NEAR && x <= b[2] + NEAR && y >= b[1] - NEAR && y <= b[3] + NEAR

// 線の部分を、CELL 四方の升目ごとに分けておく（升目の番号 → その升目を通る部分の番号）
const CELL = 20 // m
const GRID_MIN = 32 // 点: これより少ない線は、升目に分けずに全部の部分と比べる
type Grid = Map<number, number[]>
const cellKey = (cx: number, cy: number) => cx * 4194304 + cy

function gridOf(line: XY[]): Grid {
  const g: Grid = new Map()
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]
    const dx = line[i][0] - ax
    const dy = line[i][1] - ay
    const len = Math.hypot(dx, dy)
    if (!len) continue
    const steps = Math.ceil(len / (CELL / 2))
    for (let s = 0; s <= steps; s++) {
      const k = cellKey(Math.floor((ax + (dx * s) / steps) / CELL), Math.floor((ay + (dy * s) / steps) / CELL))
      const a = g.get(k)
      if (!a) g.set(k, [i])
      else if (a[a.length - 1] !== i) a.push(i)
    }
  }
  return g
}

// 点からいちばん近い線の部分までの距離と、その部分の向き（同じ距離なら前の部分）。
// 升目があるときは、点から REACH 以内の升目を通る部分だけを比べる（NEAR より近い部分は必ずその中にある）
const REACH = NEAR + CELL / 4
function nearest([px, py]: XY, line: XY[], grid: Grid | null): { dist: number; d: XY } {
  let best = { dist: Infinity, d: [1, 0] as XY }
  let at = -1
  const look = (i: number) => {
    const [ax, ay] = line[i - 1]
    const dx = line[i][0] - ax
    const dy = line[i][1] - ay
    const len2 = dx * dx + dy * dy
    if (!len2) return
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2))
    const dist = Math.hypot(px - ax - dx * t, py - ay - dy * t)
    if (dist < best.dist || (dist === best.dist && i < at)) {
      const len = Math.sqrt(len2)
      best = { dist, d: [dx / len, dy / len] }
      at = i
    }
  }
  if (!grid) {
    for (let i = 1; i < line.length; i++) look(i)
    return best
  }
  const x1 = Math.floor((px + REACH) / CELL)
  const y0 = Math.floor((py - REACH) / CELL)
  const y1 = Math.floor((py + REACH) / CELL)
  for (let cx = Math.floor((px - REACH) / CELL); cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++) grid.get(cellKey(cx, cy))?.forEach(look)
  return best
}

// 2 本の線が同じ道を通るか。1 は同じ向き、-1 は逆向き、0 は通らない
function relation(a: { s: { p: XY; d: XY }[] }, b: { xy: XY[]; box: Box; grid: Grid | null }): number {
  let shared = 0
  let dir = 0
  for (const { p, d } of a.s) {
    if (!inBox(p, b.box)) continue
    const n = nearest(p, b.xy, b.grid)
    if (n.dist > NEAR) continue
    const dot = d[0] * n.d[0] + d[1] * n.d[1]
    if (Math.abs(dot) < PARALLEL) continue
    shared += STEP
    dir += Math.sign(dot)
  }
  return shared >= MIN_SHARED ? Math.sign(dir) || 1 : 0
}

const CHOICES = [0.5, -0.5, 1.5, -1.5, 2.5, -2.5]

// 区間ごとの車線（並びは区間の順）。ほかの区間と同じ道を通らない区間は 0
export function lanes(lines: LL[][]): number[] {
  const all = lines.flat()
  if (!all.length) return lines.map(() => 0)
  const lat0 = all.reduce((a, p) => a + p[1], 0) / all.length
  const ls = lines.map((c) => {
    const xy = toXY(c, lat0)
    return { xy, box: boxOf(xy), s: samples(xy), grid: xy.length > GRID_MIN ? gridOf(xy) : null }
  })
  const n = ls.length
  const rel: number[][] = ls.map(() => new Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const r = relation(ls[i], ls[j]) || relation(ls[j], ls[i])
      rel[i][j] = r
      rel[j][i] = r
    }
  const out = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    if (!rel[i].some((r) => r)) continue
    // j の車線は、i の向きから見ると rel 倍の所にある
    const ok = (c: number) => rel[i].every((r, j) => j >= i || !r || Math.abs(c - r * out[j]) >= 0.99)
    out[i] = CHOICES.find(ok) ?? CHOICES[CHOICES.length - 1]
  }
  return out
}

const memo = new WeakMap<object, number[]>()
// 同じ区間の並び（描き直しのたびに同じ配列）は、1 度だけ数える
export function lanesOf(segs: { coords: LL[] }[]): number[] {
  const hit = memo.get(segs)
  if (hit) return hit
  const v = lanes(segs.map((s) => s.coords))
  memo.set(segs, v)
  return v
}

// 線を px だけ横にずらした線（Google マップの線用。zoom は今の拡大）。正は進む向きの右
export function shiftLine(c: LL[], px: number, zoom: number): LL[] {
  if (!px || c.length < 2) return c
  const lat0 = c[0][1]
  const k = Math.cos((lat0 * Math.PI) / 180)
  const m = (px * 156543.03392 * k) / 2 ** zoom
  const xy = toXY(c, lat0)
  const normal = (i: number): XY | null => {
    const dx = xy[i + 1][0] - xy[i][0]
    const dy = xy[i + 1][1] - xy[i][1]
    const len = Math.hypot(dx, dy)
    return len ? [dy / len, -dx / len] : null
  }
  const ns = xy.slice(0, -1).map((_, i) => normal(i))
  let last: XY = ns.find((x) => x) ?? [0, 0]
  return c.map(([lng, lat], i) => {
    const a = ns[i - 1] ?? null
    const b = ns[i] ?? null
    let nx: number
    let ny: number
    if (a && b) {
      const sx = a[0] + b[0]
      const sy = a[1] + b[1]
      const sl = Math.hypot(sx, sy)
      if (sl < 1e-6) {
        nx = b[0]
        ny = b[1]
      } else {
        const ux = sx / sl
        const uy = sy / sl
        const scale = 1 / Math.max(0.5, ux * b[0] + uy * b[1])
        nx = ux * scale
        ny = uy * scale
      }
    } else {
      const n = a ?? b ?? last
      nx = n[0]
      ny = n[1]
    }
    last = [nx, ny]
    return [lng + (nx * m) / (k * M_PER_DEG), lat + (ny * m) / M_PER_DEG]
  })
}
