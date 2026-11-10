import type { CSSProperties } from 'react'
import type { TransitRoute, TransitStep } from '../types'
import { stepColor } from '../lib/lineColor'
import { LineChip } from './LineChip'
import { tr } from '../lib/i18n'

const T = tr({
  ja: {
    mode: { walk: '徒歩', train: '電車', bus: 'バス', other: '乗り物' } as Record<string, string>,
    walk: (m: number) => `徒歩 ${m}分`,
    ride: (m: number) => `乗車 ${m}分`,
    transfer: (m: number) => `乗換 ${m}分`,
    span: (a: string, b: string) => `${a}〜${b}・`,
    total: (m: number) => `${m}分`,
    fare: (y: number) => `・運賃 ${y.toLocaleString('ja-JP')}円`,
  },
  en: {
    mode: { walk: 'Walk', train: 'Train', bus: 'Bus', other: 'Other' },
    walk: (m: number) => `Walk ${m} min`,
    ride: (m: number) => `Ride ${m} min`,
    transfer: (m: number) => `Transfer ${m} min`,
    span: (a: string, b: string) => `${a}–${b} · `,
    total: (m: number) => `${m} min`,
    fare: (y: number) => ` · Fare ¥${y.toLocaleString('en-US')}`,
  },
})

const hm = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// 前の乗り物を降りた時刻から、次の乗り物に乗る時刻までの分（どちらかが分からなければ null）
export function transferMin(prev: TransitStep, next: TransitStep): number | null {
  const a = hm(prev.arrive)
  const b = hm(next.depart)
  if (a == null || b == null) return null
  const d = b >= a ? b - a : b + 1440 - a
  return d <= 180 ? d : null
}

const isRide = (s: TransitStep) => s.mode !== 'walk'
type LineVar = CSSProperties & { '--lc': string }

// 実際の経路の区間。左に時刻、路線の色の線と丸、右に駅・停留所。乗る区間の間に路線名の札、歩く所は点線。
// 乗り換えの所に「乗換 N 分」、運賃は分かるときだけ下の行に 1 か所
export function TransitSteps({ route }: { route: TransitRoute }) {
  const steps = route.steps
  const rows = steps.map((s, i) => {
    const prev = steps.slice(0, i).reverse().find(isRide)
    const next = steps.slice(i + 1).find(isRide)
    if (!isRide(s)) {
      const gap = prev && next && isRide(steps[i + 1]) ? transferMin(prev, next) : null
      return (
        <div key={i} className="tl-seg">
          <span className="tl-node" data-at="walk" aria-hidden="true" />
          <div className="tl-body">
            {s.minutes > 0 && <p className="tl-sub num">{T.walk(s.minutes)}</p>}
            {gap != null && <p className="tl-gap num">{T.transfer(gap)}</p>}
          </div>
        </div>
      )
    }
    // 乗り物が続くとき（間に歩く段が無いとき）は、乗り換えの分を間に入れる
    const before = i > 0 && isRide(steps[i - 1]) ? transferMin(steps[i - 1], s) : null
    const color = stepColor(s, route)
    const style: LineVar = { '--lc': color ?? 'var(--ink-3)' }
    return (
      <div key={i} className="tl-seg" data-mode={s.mode} style={style}>
        {i > 0 && isRide(steps[i - 1]) && (
          <>
            <span className="tl-node" data-at="walk" aria-hidden="true" />
            <div className="tl-body">{before != null && <p className="tl-gap num">{T.transfer(before)}</p>}</div>
          </>
        )}
        <span className="tl-time">{s.depart && <span className="ts-time num">{s.depart}</span>}</span>
        <span className="tl-node" data-at="board" aria-hidden="true" />
        <span className="tl-name">{s.from}</span>
        <span className="tl-node" data-at="ride" aria-hidden="true" />
        <div className="tl-body">
          <p className="tl-route">
            <span className="sr-only">{T.mode[s.mode]} </span>
            <LineChip name={s.line.trim() || T.mode[s.mode]} color={color} mode={s.mode === 'bus' || s.mode === 'train' ? s.mode : undefined} />
          </p>
          {s.minutes > 0 && <p className="tl-sub num">{T.ride(s.minutes)}</p>}
        </div>
        <span className="tl-time">{s.arrive && <span className="ts-time num">{s.arrive}</span>}</span>
        <span className="tl-node" data-at="alight" aria-hidden="true" />
        <span className="tl-name">{s.to}</span>
      </div>
    )
  })
  return (
    <div className="tsteps">
      <div className="tl ts-tl">{rows}</div>
      <p className="ts-total num">
        {route.depart && route.arrive ? T.span(route.depart, route.arrive) : ''}
        {T.total(route.minutes)}
        {route.fare > 0 ? T.fare(route.fare) : ''}
      </p>
    </div>
  )
}
