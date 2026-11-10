import { useMemo } from 'react'
import { Button } from '@astryxdesign/core/Button'
import type { AreaData } from '../types'
import { alternatives, type Alternative, type Plan, type PlanInput, type Stop } from '../lib/planner'
import { crowdGap, levelAt } from '../lib/crowd'
import { fmt } from '../lib/time'
import { tr } from '../lib/i18n'
import { CrowdMark } from './CrowdMark'

const T = tr({
  ja: {
    group: '混雑を避ける代案',
    busy: (name: string, time: string) => `${name}（${time}）は混雑しそうです`,
    near: (name: string) => `近くの${name}`,
    swap: '入れ替える',
    swapOf: (from: string, to: string) => `${from}を${to}に入れ替える`,
  },
  en: {
    group: 'Quieter options',
    busy: (name: string, time: string) => `${name} (${time}) is likely busy`,
    near: (name: string) => `Nearby: ${name}`,
    swap: 'Swap',
    swapOf: (from: string, to: string) => `Swap ${from} for ${to}`,
  },
})

// 混雑と推定される時間（混雑・非常に混雑）にいる分。プランの混雑の滞在と同じく、時間帯ごとに重なった分だけ数える
function crowdedMin(s: Stop, day: PlanInput['day']): number {
  let n = 0
  for (let a = s.arrive; a < s.arrive + s.stay; ) {
    const b = Math.min(s.arrive + s.stay, (Math.floor(a / 60) + 1) * 60)
    if (levelAt(s.spot, a, day) >= 3 && !crowdGap(s.spot, a)) n += b - a
    a = b
  }
  return n
}

// 夜が見ごろの場所（先斗町など）は、夕方（16:30）より前の時間には代案にしない
const EVENING_FROM = 16 * 60 + 30
const fitsTime = (a: Alternative, s: Stop) => !(a.spot.best === 'evening' && s.arrive < EVENING_FROM)

// 代案を出す、混雑の滞在の長さ（分）と、出す場所の数
const MIN_CROWDED = 15
const MAX_SHOWN = 2

// 混雑を避けたプランでも混雑する時間にいる場所に、近くの混まない候補（空いている・ふつう）を代案として出す。
// 混雑の滞在が長い場所から順に。押すとその場所と入れ替える（「元に戻す」で戻せる）
export function CrowdSwap({ data, plan, input, onSwap }: { data: AreaData; plan: Plan; input: PlanInput; onSwap: (from: Stop, to: string) => void }) {
  const offers = useMemo(() => {
    if (plan.crowded < MIN_CROWDED) return []
    const out: { stop: Stop; alt: Alternative }[] = []
    const busy = plan.stops
      .map((s) => ({ s, n: crowdedMin(s, input.day) }))
      .filter((x) => x.n >= MIN_CROWDED)
      .sort((a, b) => b.n - a.n)
    for (const { s } of busy) {
      const alts = alternatives(data, s, plan, input).filter((a) => a.known && a.level <= 1 && fitsTime(a, s) && !out.some((o) => o.alt.spot.id === a.spot.id))
      const alt = alts.find((a) => a.level === 0) ?? alts[0]
      if (alt) out.push({ stop: s, alt })
      if (out.length >= MAX_SHOWN) break
    }
    return out
  }, [data, plan, input])
  if (!offers.length) return null
  return (
    <ul className="crowd-swap" aria-label={T.group}>
      {offers.map(({ stop, alt }) => (
        <li key={stop.spot.id} className="crowd-swap-item">
          <p className="crowd-swap-busy num">{T.busy(stop.spot.name, fmt(stop.arrive))}</p>
          <div className="crowd-swap-row">
            <p className="crowd-swap-alt">
              <span className="crowd-swap-name">{T.near(alt.spot.name)}</span>
              <CrowdMark level={alt.level} word />
            </p>
            <Button variant="secondary" size="sm" className="crowd-swap-btn" label={T.swapOf(stop.spot.name, alt.spot.name)} onClick={() => onSwap(stop, alt.spot.id)}>
              {T.swap}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
