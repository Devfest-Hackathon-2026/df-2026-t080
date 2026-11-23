import { useMemo } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import type { AreaData } from '../types'
import { alternatives, type Alternative, type Plan, type PlanInput, type Stop } from '../lib/planner'
import { crowdGap, levelAt } from '../lib/crowd'
import { fmt } from '../lib/time'
import { distM, walkMin } from '../lib/geo'
import { distText } from '../lib/walkDist'
import { tr } from '../lib/i18n'
import { CrowdMark } from './CrowdMark'
import { Sheet } from './Sheet'

const T = tr({
  ja: {
    group: '混雑を避ける代替案',
    busy: (name: string, time: string) => `${name}（${time}）は混雑が予想されます`,
    near: (name: string) => `近くの${name}`,
    swap: '入れ替える',
    swapOf: (from: string, to: string) => `${from}を${to}に入れ替える`,
    line: (n: number) => `混雑を避けられる場所が${n}か所あります`,
    title: '混雑を避ける',
    lead: '混雑と推定される時間にいる場所と、近くの空いている候補です。入れ替えても「元に戻す」で戻せます。',
    stay: (from: string, to: string, n: number) => `${from}〜${to}・そのうち混雑の時間 約${n}分`,
    from: (name: string, min: number, d: string) => `${name}から徒歩 約${min}分（${d}）`,
    caution: (s: string) => `注意：${s}`,
  },
  en: {
    group: 'Quieter options',
    busy: (name: string, time: string) => `${name} (${time}) is likely busy`,
    near: (name: string) => `Nearby: ${name}`,
    swap: 'Swap',
    swapOf: (from: string, to: string) => `Swap ${from} for ${to}`,
    line: (n: number) => `Avoid the crowds at ${n} ${n === 1 ? 'place' : 'places'}`,
    title: 'Avoid the Crowds',
    lead: 'Places on your plan at times likely to be busy, with quieter options nearby. You can undo a swap.',
    stay: (from: string, to: string, n: number) => `${from}–${to} · about ${n} min at busy times`,
    from: (name: string, min: number, d: string) => `About ${min} min walk from ${name} (${d})`,
    caution: (s: string) => `Note: ${s}`,
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

// 滞在のあいだでいちばん混む段
function peakLevel(s: Stop, day: PlanInput['day']): number {
  let top = 0
  for (let a = s.arrive; a < s.arrive + s.stay; a = (Math.floor(a / 60) + 1) * 60) top = Math.max(top, levelAt(s.spot, a, day))
  return top
}

// 夜が見ごろの場所（先斗町など）は、夕方（16:30）より前の時間には代案にしない
const EVENING_FROM = 16 * 60 + 30
const fitsTime = (a: Alternative, s: Stop) => !(a.spot.best === 'evening' && s.arrive < EVENING_FROM)

// 代案を出す、混雑の滞在の長さ（分）と、出す場所の数
const MIN_CROWDED = 15
const MAX_SHOWN = 2

export type CrowdOffer = { stop: Stop; alt: Alternative }

// 混雑を避けたプランでも混雑する時間にいる場所に、近くの混まない候補（空いている・ふつう）を代案として出す。
// 混雑の滞在が長い場所から順に。押すとその場所と入れ替える（「元に戻す」で戻せる）
export function useCrowdOffers(data: AreaData, plan: Plan, input: PlanInput): CrowdOffer[] {
  return useMemo(() => {
    if (plan.crowded < MIN_CROWDED) return []
    const out: CrowdOffer[] = []
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
}

function SwapList({ offers, day, onSwap }: { offers: CrowdOffer[]; day: PlanInput['day']; onSwap: (from: Stop, to: string) => void }) {
  return (
    <ul className="crowd-swap" aria-label={T.group}>
      {offers.map(({ stop, alt }) => {
        const m = distM(stop.spot, alt.spot)
        return (
          <li key={stop.spot.id} className="crowd-swap-item">
            <div className="crowd-swap-head">
              <p className="crowd-swap-busy-name">{stop.spot.name}</p>
              <CrowdMark level={peakLevel(stop, day)} word />
            </div>
            <p className="crowd-swap-busy num">{T.stay(fmt(stop.arrive), fmt(stop.arrive + stop.stay), crowdedMin(stop, day))}</p>
            <div className="crowd-swap-alt-box">
              <div className="crowd-swap-head">
                <p className="crowd-swap-name">{T.near(alt.spot.name)}</p>
                <CrowdMark level={alt.level} word />
              </div>
              <p className="crowd-swap-meta num">{T.from(stop.spot.name, walkMin(stop.spot, alt.spot), distText(m))}</p>
              {alt.spot.why && <p className="crowd-swap-why">{alt.spot.why}</p>}
              {alt.spot.downside && <p className="crowd-swap-meta">{T.caution(alt.spot.downside)}</p>}
              <Button variant="secondary" size="sm" className="crowd-swap-btn" label={T.swapOf(stop.spot.name, alt.spot.name)} onClick={() => onSwap(stop, alt.spot.id)}>
                {T.swap}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// 比べの札の下の 1 行。押すと、代案の並ぶシートを開く（シートは App が画面のいちばん外側に置く）
export function CrowdSwap({ data, plan, input, onOpen }: { data: AreaData; plan: Plan; input: PlanInput; onOpen: () => void }) {
  const offers = useCrowdOffers(data, plan, input)
  if (!offers.length) return null
  return (
    <button type="button" className="sum-link" onClick={onOpen}>
      <span>{T.line(offers.length)}</span>
      <Icon icon="chevronRight" color="inherit" size="xsm" />
    </button>
  )
}

export function CrowdSwapSheet({ data, plan, input, onSwap, onClose }: { data: AreaData; plan: Plan; input: PlanInput; onSwap: (from: Stop, to: string) => void; onClose: () => void }) {
  const offers = useCrowdOffers(data, plan, input)
  if (!offers.length) return null
  return (
    <Sheet title={T.title} lead={T.lead} onClose={onClose} card>
      <SwapList
        offers={offers}
        day={input.day}
        onSwap={(from, to) => {
          onClose()
          onSwap(from, to)
        }}
      />
    </Sheet>
  )
}
