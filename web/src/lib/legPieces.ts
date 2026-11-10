// 区間の線を、歩く所と乗る所に分ける（地図で、乗る所は路線の色、歩く所は灰色の点線にするため）。
// - 時刻表から選んだ便と、まだ選んでいない区間に見つけた便（スケジュールの区間の行に出している便）:
//   便の線の 3 つの部分（停留所まで歩く・乗る・停留所から歩く）
// - 乗換のスクリーンショットから入れた経路: 駅の位置が分からないので、区間の道に沿った線を、段ごとの道のりの目安（1 分に進む距離 × 分）の割合で切る
// - どちらも無い区間は null（電車・バスか徒歩かの 1 本の線のまま）
import type { BusTrip, RailOpt, TransitRoute, TransitStep } from '../types'
import type { LL } from '../components/mapShared'
import { busParts, isTrain, rideMinutes } from './bus'
import { bareLine, busColor, railColor, stepColor } from './lineColor'
import { isEn } from './i18n'

// 乗る駅・降りる駅（停留所）の名前と位置
export type PieceEnd = { name: string; ll: LL }
// color: 乗る所の路線の色（路線の名前が分からない段は null）。mode・minutes・name: 地図の手段ごとの札（name は路線名の短い形。出せなければ空）。
// ends: 乗る所の、乗る駅と降りる駅（位置の分かる便と電車の目安だけ）
export type Piece = { kind: 'walk' | 'ride'; coords: LL[]; color: string | null; mode: TransitStep['mode']; minutes: number; name: string; ends?: [PieceEnd, PieceEnd] }

const endOf = (s: { name: string; lat: number; lng: number }): PieceEnd => ({ name: s.name, ll: [s.lng, s.lat] })

const SHORT_MAX = isEn ? 10 : 5

// 一般の語だけの名前（短い形がこれになるときは使わない）
const GENERIC = /^(line|bus|railway|railroad|subway|metro|train|線|本線|支線|内回り|外回り)$/i

// 路線名の短い形（市バス 205 → 205、京都市営地下鉄烏丸線 → 烏丸線、Tokyo Metro Hanzomon Line → Hanzomon）。短くできなければ空
export function shortLine(name: string): string {
  const s = bareLine(name)
  const last = s.split(/\s+/).pop() ?? ''
  const line = s.match(/(\S+) Line$/i)
  const rest = s.replace(/^.*(地下鉄|メトロ|鉄道|電鉄|交通局|交通|バス)/, '').trim()
  for (const c of [s, line?.[0] ?? '', line?.[1] ?? '', last, rest]) if (c && !GENERIC.test(c) && [...c].length <= SHORT_MAX) return c
  return ''
}

// 1 分に進む道のりの目安（m）
const PACE: Record<TransitStep['mode'], number> = { walk: 75, bus: 250, train: 500, other: 350 }

// 線の長さの from〜to の割合の所（0〜1）
function cut(c: LL[], from: number, to: number): LL[] {
  const k = Math.cos((c[0][1] * Math.PI) / 180)
  const acc = [0]
  for (let i = 1; i < c.length; i++) acc.push(acc[i - 1] + Math.hypot((c[i][0] - c[i - 1][0]) * k, c[i][1] - c[i - 1][1]))
  const total = acc[acc.length - 1]
  if (!total) return [c[0], c[c.length - 1]]
  const at = (d: number): LL => {
    let i = 0
    while (i < c.length - 2 && acc[i + 1] < d) i++
    const len = acc[i + 1] - acc[i]
    const f = len ? Math.min(1, Math.max(0, (d - acc[i]) / len)) : 0
    return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f]
  }
  const a = from * total
  const b = to * total
  const out: LL[] = [at(a)]
  for (let i = 0; i < c.length; i++) if (acc[i] > a && acc[i] < b) out.push(c[i])
  out.push(at(b))
  return out
}

function busPieces(t: BusTrip, A: LL, B: LL): Piece[] {
  const p = busParts(t, A, B)
  const pieces: Piece[] = [
    { kind: 'walk', coords: p.walkTo, color: null, mode: 'walk', minutes: t.walkTo, name: '' },
    { kind: 'ride', coords: p.ride, color: busColor(t), mode: isTrain(t) ? 'train' : 'bus', minutes: rideMinutes(t), name: shortLine(t.route), ends: [endOf(t.board), endOf(t.alight)] },
    { kind: 'walk', coords: p.walkFrom, color: null, mode: 'walk', minutes: t.walkFrom, name: '' },
  ]
  return pieces.filter((x) => x.coords.length > 1)
}

// 電車の目安: 駅まで歩く（直線）・駅の並びに沿って乗る・駅から歩く（直線）
function railPieces(r: RailOpt, A: LL, B: LL): Piece[] {
  const on: LL = [r.board.lng, r.board.lat]
  const off: LL = [r.alight.lng, r.alight.lat]
  const ride: LL[] = r.path.length > 1 ? r.path : [on, off]
  const pieces: Piece[] = [
    { kind: 'walk', coords: [A, on], color: null, mode: 'walk', minutes: r.walkTo, name: '' },
    { kind: 'ride', coords: ride, color: railColor(r), mode: 'train', minutes: r.ride, name: shortLine(r.line), ends: [endOf(r.board), endOf(r.alight)] },
    { kind: 'walk', coords: [off, B], color: null, mode: 'walk', minutes: r.walkFrom, name: '' },
  ]
  return pieces.filter((x) => x.coords.length > 1)
}

// found: 便も乗換も入れていない区間に見つけた便（入れた物があればそちらを描く）。rail: 便が無い区間の電車の目安
export function legPieces(real: TransitRoute | undefined, A: LL, B: LL, line: LL[] | null, found?: BusTrip | null, rail?: RailOpt): Piece[] | null {
  if (!real) return found ? busPieces(found, A, B) : rail ? railPieces(rail, A, B) : null
  if (real.bus) return busPieces(real.bus, A, B)
  if (!line || line.length < 2 || !real.steps.length) return null
  const w = real.steps.map((s) => Math.max(1, s.minutes) * PACE[s.mode])
  const sum = w.reduce((a, b) => a + b, 0)
  let t = 0
  return real.steps.map((s, i) => {
    const t0 = t
    t = i === real.steps.length - 1 ? 1 : t + w[i] / sum
    const walk = s.mode === 'walk'
    return { kind: walk ? 'walk' : 'ride', coords: cut(line, t0, t), color: stepColor(s, real), mode: s.mode, minutes: s.minutes, name: walk ? '' : shortLine(s.line) }
  })
}

// 地図に印を置く、乗る駅・降りる駅。legs: その駅で乗るか降りる区間の番号。offs: そのうち、その駅で降りる区間の番号。
// color・coords・end・idx: 最初に見つけた区間の、路線の色と乗る線とその端（0 か 1）と区間の番号
export type BoardStop = PieceEnd & { legs: number[]; offs: number[]; color: string | null; coords: LL[]; end: 0 | 1; idx: number }

const SAME_NAME = 400 // 同じ名前の駅を 1 つにまとめる距離（m）
const SAME_SPOT = 40 // 名前が違っても 1 つにまとめる距離（m）
const meters = (a: LL, b: LL) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111320

// 区間の乗る所の両端の駅。降りた駅でそのまま次に乗るときなど、同じ駅は 1 つにまとめる
export function boardStops(legs: { idx: number; pieces?: Piece[] | null }[]): BoardStop[] {
  const out: BoardStop[] = []
  for (const l of [...legs].sort((a, b) => a.idx - b.idx)) {
    for (const p of l.pieces ?? []) {
      if (p.kind !== 'ride' || !p.ends) continue
      p.ends.forEach((e, k) => {
        const same = out.find((s) => meters(s.ll, e.ll) < (s.name === e.name ? SAME_NAME : SAME_SPOT))
        if (!same) out.push({ ...e, legs: [l.idx], offs: k ? [l.idx] : [], color: p.color, coords: p.coords, end: k ? 1 : 0, idx: l.idx })
        else {
          if (!same.legs.includes(l.idx)) same.legs.push(l.idx)
          if (k && !same.offs.includes(l.idx)) same.offs.push(l.idx)
        }
      })
    }
  }
  return out
}
