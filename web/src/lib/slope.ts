// 歩く所の上り下り（サーバーが、道に沿った線の上で国土地理院の標高タイルから求める。日本だけ）。
// 徒歩の区間は区間の全部、時刻表から選んだ便の区間は停留所まで・停留所からの歩く所だけを見る。
// 乗換のスクリーンショットから入れた経路は、駅の位置が分からないので見ない。
// 坂のある区間だけ、区間の行に小さな高さの線と一言を出す（上りが 20m 以上か、急な所があって 15m 以上の区間。下りも同じ。取れなかった区間は何も出さない）
import { useEffect, useState } from 'react'
import type { Leg } from './geo'
import type { LL } from '../components/mapShared'
import { loggedFetch } from './apiLog'
import { tr } from './i18n'

// up・down: 上り・下りの合計（m）。steepUp・steepDown: 80m の間に 8m 以上（10%）上る・下る所があるか
export type Slope = { up: number; down: number; steepUp: boolean; steepDown: boolean }

const W = tr({
  ja: {
    up: (m: number) => `上り ${m}m`,
    down: (m: number) => `下り ${m}m`,
    steep: '急な坂あり',
    sep: '・',
    word: { up: 'なだらかな上り', down: 'なだらかな下り', both: '上り下りあり' },
    steepWord: { up: '急な上り', down: '急な下り', both: '急な上り下りあり' },
    label: (word: string, detail: string) => `${word}（${detail}）`,
  },
  en: {
    up: (m: number) => `${m} m climb`,
    down: (m: number) => `${m} m descent`,
    steep: 'steep sections',
    sep: ' · ',
    word: { up: 'Gentle climb', down: 'Gentle descent', both: 'Ups and downs' },
    steepWord: { up: 'Steep climb', down: 'Steep descent', both: 'Steep ups and downs' },
    label: (word: string, detail: string) => `${word} (${detail})`,
  },
})

const MIN = 20
const STEEP_MIN = 15

// 聞き終えた 2 点の結果（データが無い所は null）
const got = new Map<string, Slope | null>()
const pairKey = ([a, b]: [LL, LL]) => `${a.join(',')}>${b.join(',')}`

function pairs(leg: Leg): [LL, LL][] | null {
  const A: LL = [leg.from.lng, leg.from.lat]
  const B: LL = [leg.to.lng, leg.to.lat]
  const bus = leg.real?.bus
  if (bus) {
    return [
      [A, [bus.board.lng, bus.board.lat]],
      [[bus.alight.lng, bus.alight.lat], B],
    ]
  }
  if (leg.real || leg.mode !== 'walk') return null
  return [[A, B]]
}

function combine(leg: Leg): Slope | null {
  const ps = pairs(leg)
  if (!ps) return null
  const rs = ps.map((p) => got.get(pairKey(p)))
  if (rs.some((r) => !r)) return null
  return rs.reduce<Slope>(
    (s, r) => ({ up: s.up + r!.up, down: s.down + r!.down, steepUp: s.steepUp || r!.steepUp, steepDown: s.steepDown || r!.steepDown }),
    { up: 0, down: 0, steepUp: false, steepDown: false },
  )
}

async function ask(need: [LL, LL][]) {
  for (let i = 0; i < need.length; i += 24) {
    const part = need.slice(i, i + 24)
    const body = JSON.stringify({ legs: part.map(([a, b]) => ({ a, b })) })
    const r = await loggedFetch('/api/slope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    if (!r.ok) throw new Error(String(r.status))
    const j = (await r.json()) as { slopes: (Partial<Slope> | null)[] }
    part.forEach((p, k) => {
      const s = j.slopes[k]
      if (!s) return
      got.set(pairKey(p), typeof s.up === 'number' ? { up: s.up, down: s.down ?? 0, steepUp: !!s.steepUp, steepDown: !!s.steepDown } : null)
    })
  }
}

// 区間ごとの上り下り（見ない区間・取れていない区間は null）と、標高のデータを使ったか（出典を出すか）
export function useSlopes(legs: Leg[], on: boolean): { slopes: (Slope | null)[]; used: boolean } {
  const [, setTick] = useState(0)
  const want = on ? legs.flatMap((l) => pairs(l) ?? []) : []
  const sig = want.map(pairKey).join(';')
  useEffect(() => {
    if (!sig) return
    let alive = true
    let retry: number | null = null
    const run = async (tries: number) => {
      const seen = new Set<string>()
      const need = want.filter((p) => {
        const k = pairKey(p)
        if (got.has(k) || seen.has(k)) return false
        seen.add(k)
        return true
      })
      if (!need.length) return
      try {
        await ask(need)
      } catch {
        /* 次の機会にもう一度 */
      }
      if (!alive) return
      setTick((t) => t + 1)
      if (tries > 0 && need.some((p) => !got.has(pairKey(p)))) retry = window.setTimeout(() => void run(tries - 1), 8000)
    }
    const t = window.setTimeout(() => void run(2), 400)
    return () => {
      alive = false
      window.clearTimeout(t)
      if (retry !== null) window.clearTimeout(retry)
    }
    // want は sig から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  const slopes = legs.map((l) => (on ? combine(l) : null))
  return { slopes, used: slopes.some((s) => s !== null) }
}

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5)

export type SlopeKind = 'up' | 'down' | 'both'
// 区間の行に出す物。kind: 上りだけ・下りだけ・両方、steep: 急な所があるか、word: 一言、label: 読み上げ（一言と上り下りの m）、
// path: 小さな高さの線（幅 36・高さ 12 の SVG の形。高さの並びは持っていないので、上り下りの量から描く代表の形）
export type SlopeLook = { kind: SlopeKind; steep: boolean; word: string; label: string; detail: string; path: string }

// 平らな区間（上り下りが少ない区間）は null
export function slopeLook(s: Slope | null | undefined): SlopeLook | null {
  if (!s) return null
  const up = s.up >= MIN || (s.steepUp && s.up >= STEEP_MIN)
  const down = s.down >= MIN || (s.steepDown && s.down >= STEEP_MIN)
  if (!up && !down) return null
  const kind: SlopeKind = up && down ? 'both' : up ? 'up' : 'down'
  const steep = (up && s.steepUp) || (down && s.steepDown)
  const word = (steep ? W.steepWord : W.word)[kind]
  const parts = [...(s.up >= 5 ? [W.up(round5(s.up))] : []), ...(s.down >= 5 ? [W.down(round5(s.down))] : []), ...(s.steepUp || s.steepDown ? [W.steep] : [])]
  const detail = parts.join(W.sep)
  return { kind, steep, word, label: W.label(word, detail), detail, path: hillPath(kind, steep, s) }
}

const TOP = 1.5
const BOTTOM = 10.5
const f1 = (n: number) => Math.round(n * 10) / 10

// 小さな高さの線の形。上りは左から右へ上がり、下りはその左右を返した形。急な区間は、平らな所のあとに短く上がる形。
// 上りと下りの両方がある区間は、上ってから下る山の形にし、出発と到着の高さの差を上り下りの量の割合で付ける
function hillPath(kind: SlopeKind, steep: boolean, s: Slope): string {
  if (kind !== 'both') {
    const [a, b] = kind === 'up' ? [BOTTOM, TOP] : [TOP, BOTTOM]
    return steep
      ? `M1 ${a} L11 ${a} C16 ${a} 18 ${b} 23 ${b} L35 ${b}`
      : `M1 ${f1(a - (a - b) * 0.18)} C12 ${f1(a - (a - b) * 0.18)} 24 ${f1(b + (a - b) * 0.18)} 35 ${f1(b + (a - b) * 0.18)}`
  }
  const end = s.up - s.down
  const low = Math.min(0, end)
  const y = (h: number) => f1(BOTTOM - ((h - low) / (s.up - low)) * (BOTTOM - TOP))
  const y0 = y(0)
  const y1 = y(end)
  return steep
    ? `M1 ${y0} L8 ${y0} C12 ${y0} 14 ${TOP} 18 ${TOP} C22 ${TOP} 24 ${y1} 28 ${y1} L35 ${y1}`
    : `M1 ${y0} C8 ${y0} 12 ${TOP} 18 ${TOP} C24 ${TOP} 28 ${y1} 35 ${y1}`
}
