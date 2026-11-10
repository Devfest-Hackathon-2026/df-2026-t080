import { useState } from 'react'
import { FIRST_HOUR, LAST_HOUR, LEVEL_LABEL } from '../lib/crowd'
import { CrowdMark } from './CrowdMark'
import { tr } from '../lib/i18n'

const T = tr({
  ja: {
    hour: (h: number) => `${h}時`,
    comma: '、',
    none: (h: number) => `訪問予定の${h}時台は推定がありません`,
    gap: (h: number) => `${h}時台は推定がありません`,
    noData: '推定なし',
    range: '8時〜18時の推定',
    during: (h: number) => `${h}時台`,
    visit: '訪問予定',
    taller: '棒が高いほど混雑',
  },
  en: {
    hour: (h: number) => `${h}:00`,
    comma: ', ',
    none: (h: number) => `No estimate for ${h}:00, your visit`,
    gap: (h: number) => `No estimate for ${h}:00`,
    noData: 'No estimate',
    range: 'Estimates for 8:00–18:00',
    during: (h: number) => `${h}:00`,
    visit: 'Your visit',
    taller: 'Taller bars are busier',
  },
})

// 混雑する時間帯。棒の高さと色の両方で混み具合を表し、行く時間の棒に印を付ける。読みの行の右に、棒の高さの読み方を添える。
// 訪問が推定のない時間帯（夜など）のときは、どの棒にも印を付けない。
// gaps（Gemini が答えず、サーバーが埋めた時間帯。8 時台が 0）は、棒を描かず「推定がありません」と読む
export function HourBars({ levels, visitHour, gaps = [] }: { levels: number[]; visitHour: number; gaps?: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const gap = (h: number) => gaps.includes(h - FIRST_HOUR)
  const highlight = visitHour >= FIRST_HOUR && visitHour <= LAST_HOUR ? visitHour : null
  const shown = hover ?? highlight
  const lv = shown === null ? 0 : (levels[shown - FIRST_HOUR] ?? 0)
  const summary = levels.map((v, i) => `${T.hour(i + FIRST_HOUR)} ${gap(i + FIRST_HOUR) ? T.noData : LEVEL_LABEL[v]}`).join(T.comma)
  return (
    <figure className="bars">
      <figcaption className="bars-read">
        {shown === null ? (
          <span className="muted num">{visitHour >= 0 ? T.none(visitHour) : T.range}</span>
        ) : gap(shown) ? (
          <span className="muted num">{shown === highlight ? T.none(shown) : T.gap(shown)}</span>
        ) : (
          <>
            <span className="num">{T.during(shown)}</span>
            <CrowdMark level={lv} word />
            {shown === highlight && <span className="muted">{T.visit}</span>}
          </>
        )}
        <span className="bars-hint">{T.taller}</span>
      </figcaption>
      <div className="bars-plot" role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
        {levels.map((v, i) => {
          const h = i + FIRST_HOUR
          return (
            <span key={h} className="bars-col" onMouseEnter={() => setHover(h)} title={`${T.hour(h)}: ${gap(h) ? T.noData : LEVEL_LABEL[v]}`}>
              {!gap(h) && <span className="bars-bar" data-heat={v} data-on={h === highlight || undefined} style={{ height: `${((v + 1) / 5) * 100}%` }} />}
            </span>
          )
        })}
      </div>
      <div className="bars-axis num" aria-hidden="true">
        {levels.map((_, i) => (
          <span key={i}>{(i + FIRST_HOUR) % 3 === 2 ? T.hour(i + FIRST_HOUR) : ''}</span>
        ))}
      </div>
    </figure>
  )
}
