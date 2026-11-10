import type { Plan, UsualPlan } from '../lib/planner'
import { fmt, fmtDur } from '../lib/time'
import { tr } from '../lib/i18n'

const T = tr({
  ja: {
    what: '混雑と推定される時間の滞在',
    // [前, 値, 後] の値だけを強くする
    shorter: (p: string) => ['', p, '短くなります'],
    longer: (d: string) => ['', d, '長くなります'],
    same: 'よくある回り方と同じくらいです',
    usualLate: (t: string) => `よくある回り方では、帰る時刻（${t}）に間に合いません`,
    usualClosed: 'よくある回り方では、閉まる時刻を過ぎる場所があります',
    never: 'このプランは、混雑と推定される時間に一度も当たりません',
    move: '移動',
    plan: 'このプラン',
    usual: 'よくある回り方',
    about: 'よくある回り方は、このプランと同じ場所を、同じ滞在とゆとりで、混む時間を気にせず近い順に回り、食事はいつもの時間（昼食は11時30分、夕食は17時30分を過ぎたら）にとった場合です。混雑の滞在は、混雑・非常に混雑と推定される時間帯に、その場所にいる時間です。移動は、場所と場所の間を動く時間です。混雑を避けた割合は、よくある回り方の混雑の滞在のうち、このプランで減った分です。',
  },
  en: {
    what: 'Time at places during estimated crowded hours',
    shorter: (p: string) => ['', p, ' less'],
    longer: (d: string) => ['', d, ' more'],
    same: 'About the same as the usual route',
    usualLate: (t: string) => `The usual route can’t make it back by ${t}`,
    usualClosed: 'The usual route stays somewhere past its closing time',
    never: 'This plan never hits an estimated crowded hour',
    move: 'Travel',
    plan: 'This plan',
    usual: 'Usual route',
    about: 'The usual route visits the same places as this plan, with the same stays and breaks, in order of distance without minding busy times, and eats at the usual times (lunch after 11:30, dinner after 17:30). Crowded time is time spent at a place during hours estimated as Busy or Very Busy. Travel is time spent moving between places. The share avoided is how much of the usual route’s crowded time this plan cuts.',
  },
})

// 分の差に符号を付ける（増えたら +、減ったら −）
const signed = (m: number) => {
  const r = Math.round(m)
  return r === 0 ? `±${fmtDur(0)}` : `${r > 0 ? '+' : '\u2212'}${fmtDur(Math.abs(r))}`
}

// 混雑と推定される時間の滞在を、よくある回り方と比べる。ふだんは、よくある回り方とこのプランの 2 つの分と、
// 減った割合・移動の差だけを出し、押すと 2 本の棒と説明を開く。全部避けられたときは、割合を出さない。
// どちらの回り方も混む場所に当たらないときは、比べずにそう言う
// end: 帰る時刻（到着の時刻）。よくある回り方がそれに間に合わないとき・閉まる時刻を過ぎる場所があるときは、混雑の長さで負けたとは言わずにそう言う
export function Compare({ plan, usual, end }: { plan: Plan; usual: UsualPlan | null; end?: number }) {
  if (!usual) return null
  if (Math.round(plan.crowded) === 0 && Math.round(usual.crowded) === 0) {
    return (
      <div className="cmp">
        <p className="cmp-sum cmp-still">
          <span className="cmp-line">{T.never}</span>
        </p>
      </div>
    )
  }
  const move = signed(plan.moving - usual.moving)
  const max = Math.max(plan.crowded, usual.crowded, 1)
  const diff = usual.crowded - plan.crowded
  const usualLate = end !== undefined && usual.finish > end
  const planClosed = plan.stops.filter((s) => s.closeOver).length
  const lose = usualLate ? T.usualLate(fmt(end!)) : usual.closed > planClosed ? T.usualClosed : T.longer(fmtDur(-diff))
  const parts = diff >= 10 ? (plan.crowded === 0 ? null : T.shorter(`${Math.min(99, Math.round((diff / usual.crowded) * 100))}%`)) : diff <= -10 ? lose : T.same
  return (
    <details className={`cmp${diff >= 10 ? (parts ? ' cmp-win' : ' cmp-all') : ''}`}>
      <summary className="cmp-sum">
        <span className="cmp-line">
          {T.what}
          <span className="cmp-nums">
            <span className="nw">
              {T.usual} <strong className="num">{fmtDur(usual.crowded)}</strong>
            </span>
            <span className="nw">
              <span aria-hidden="true">→ </span>
              {T.plan} <strong className={`num${diff >= 10 ? ' cmp-good' : ''}`}>{fmtDur(plan.crowded)}</strong>
            </span>
          </span>
          <span className="cmp-diff">
            {typeof parts === 'string' ? (
              <span>{parts}</span>
            ) : (
              parts && (
                <span>
                  {parts[0]}
                  <strong className={`num${diff >= 10 ? ' cmp-big' : ''}`}>{parts[1]}</strong>
                  {parts[2]}
                </span>
              )
            )}
            <span>
              {T.move} <strong className="num">{move}</strong>
            </span>
          </span>
        </span>
      </summary>
      <div className="cmp-row">
        <span className="cmp-label">{T.plan}</span>
        <span className="cmp-bar" aria-hidden="true">
          <span className="cmp-fill" style={{ width: `${(plan.crowded / max) * 100}%` }} />
        </span>
        <span className="cmp-value strong num">{fmtDur(plan.crowded)}</span>
      </div>
      <div className="cmp-row usual">
        <span className="cmp-label">{T.usual}</span>
        <span className="cmp-bar" aria-hidden="true">
          <span className="cmp-fill" style={{ width: `${(usual.crowded / max) * 100}%` }} />
        </span>
        <span className="cmp-value num">{fmtDur(usual.crowded)}</span>
      </div>
      <p className="note">{T.about}</p>
    </details>
  )
}
