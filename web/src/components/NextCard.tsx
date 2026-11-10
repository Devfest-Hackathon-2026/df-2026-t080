import type { ReactNode } from 'react'
import type { Plan } from '../lib/planner'
import { mapsAppDirUrl, mapsDirUrl } from '../lib/geo'
import { MapsLink } from './MapsLink'
import { fmt, fmtDur } from '../lib/time'
import { tr } from '../lib/i18n'

const T = tr({
  ja: {
    nowTitle: 'いまの予定',
    now: 'いま',
    leave: (t: ReactNode) => <>{t}に出発</>,
    left: (d: string) => `あと${d}`,
    then: (name: string) => `次は${name}`,
    nextTitle: '次の予定',
    next: '次',
    arrive: (t: ReactNode) => <>{t}に着く予定</>,
    moving: 'いま移動中',
    maps: 'Google マップで経路を開く',
  },
  en: {
    nowTitle: 'Now',
    now: 'Now',
    leave: (t: ReactNode) => <>Leave at {t}</>,
    left: (d: string) => `in ${d}`,
    then: (name: string) => `Next: ${name}`,
    nextTitle: 'Next',
    next: 'Next',
    arrive: (t: ReactNode) => <>Arrive at {t}</>,
    moving: 'On the way',
    maps: 'Directions in Google Maps',
  },
})

const no = (i: number) => String(i + 1)
const time = (m: number) => <span className="next-time num">{fmt(m)}</span>

// 旅の当日だけ、いま居る場所と次の行き先を出す（メメトリップの「次」を参考にした）。
// 主役は「何時に出るか」（出たあとは「何時に着くか」）。その上に行き先の名前、下に残りの時間や次の行き先を小さく、
// 経路のボタンは横いっぱいに一番下へ置く
export function NextCard({ plan, now, onOpen }: { plan: Plan; now: number; onOpen: (id: string) => void }) {
  const here = plan.stops.findIndex((s) => s.arrive <= now && now < s.depart)
  const next = plan.stops.findIndex((s) => s.arrive > now)
  if (next < 0 && here < 0) return null
  if (here >= 0) {
    const s = plan.stops[here]
    const after = plan.stops[here + 1]
    return (
      <section className="next" aria-label={T.nowTitle}>
        <span className="next-label">{T.now}</span>
        <button type="button" className="next-main" onClick={() => onOpen(s.spot.id)}>
          <span className="badge num">{no(here)}</span>
          <span className="next-name">{s.spot.name}</span>
        </button>
        <p className="next-when">
          <span className="next-key">{T.leave(time(s.depart))}</span>
          <span className="next-left num">{T.left(fmtDur(s.depart - now))}</span>
        </p>
        {after && <p className="next-sub">{T.then(after.spot.name)}</p>}
      </section>
    )
  }
  const s = plan.stops[next]
  const leaveAt = s.arrive - s.leg.minutes - s.ease
  const going = leaveAt <= now
  return (
    <section className="next" aria-label={T.nextTitle}>
      <span className="next-label">{T.next}</span>
      <button type="button" className="next-main" onClick={() => onOpen(s.spot.id)}>
        <span className="badge num">{no(next)}</span>
        <span className="next-name">{s.spot.name}</span>
      </button>
      {going ? (
        <p className="next-when">
          <span className="next-key">{T.arrive(time(s.arrive))}</span>
          <span className="next-left">{T.moving}</span>
        </p>
      ) : (
        <>
          <p className="next-when">
            <span className="next-key">{T.leave(time(leaveAt))}</span>
            <span className="next-left num">{T.left(fmtDur(leaveAt - now))}</span>
          </p>
          <p className="next-sub">{T.arrive(<span className="num">{fmt(s.arrive)}</span>)}</p>
        </>
      )}
      <MapsLink className="btn-line" web={mapsDirUrl(s.leg)} app={mapsAppDirUrl(s.leg)}>
        {T.maps}
      </MapsLink>
    </section>
  )
}
