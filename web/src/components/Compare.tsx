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
    usualClosed: 'よくある回り方では、営業終了後になる場所があります',
    never: 'このプランは、混雑と推定される時間に一度も当たりません',
    // 移動の差（よくある回り方と比べて）。[前, 値, 後] の値だけを強くする
    moveLess: (d: string): [string, string, string] => ['移動は', d, '短くなります'],
    moveMore: (d: string): [string, string, string] => ['移動は', d, '長くなります'],
    plan: 'このプラン',
    usual: 'よくある回り方',
    about: 'よくある回り方は、このプランと同じ場所を、同じ滞在とゆとりで、混雑する時間を考慮せず近い順に回り、食事は一般的な時間（昼食は11時30分、夕食は17時30分を過ぎたら）にとった場合です。混雑の滞在は、混雑・非常に混雑と推定される時間帯に、その場所にいる時間です。移動は、場所と場所の間を移動する時間です。混雑を避けた割合は、よくある回り方の混雑の滞在のうち、このプランで減った分です。',
  },
  en: {
    what: 'Time at places during estimated crowded hours',
    shorter: (p: string) => ['', p, ' less'],
    longer: (d: string) => ['', d, ' more'],
    same: 'About the same as the usual route',
    usualLate: (t: string) => `The usual route can’t make it back by ${t}`,
    usualClosed: 'The usual route stays somewhere past its closing time',
    never: 'This plan never hits an estimated crowded hour',
    moveLess: (d: string): [string, string, string] => ['', d, ' less travel'],
    moveMore: (d: string): [string, string, string] => ['', d, ' more travel'],
    plan: 'This plan',
    usual: 'Usual route',
    about: 'The usual route visits the same places as this plan, with the same stays and breaks, in order of distance without minding busy times, and eats at the usual times (lunch after 11:30, dinner after 17:30). Crowded time is time spent at a place during hours estimated as Busy or Very Busy. Travel is time spent moving between places. The share avoided is how much of the usual route’s crowded time this plan cuts.',
  },
})

// 移動の時間の差（分・このプラン − よくある回り方）を言葉にする。分に丸めて同じなら null（出さない）
export function moveWords(m: number): [string, string, string] | null {
  const r = Math.round(m)
  if (r === 0) return null
  return r < 0 ? T.moveLess(fmtDur(-r)) : T.moveMore(fmtDur(r))
}

// 混雑と推定される時間の滞在を、よくある回り方と比べる。差（減った割合など）をいちばん大きく出し、その下に
// よくある回り方とこのプランの 2 本の棒を、時間に比べた長さで並べる。押すと移動の差と説明を開く。
// どちらの回り方も混む場所に当たらないときは、比べずにそう言う
// end: 帰る時刻（到着の時刻）。よくある回り方がそれに間に合わないとき・閉まる時刻を過ぎる場所があるときは、混雑の長さで負けたとは言わずにそう言う
export function Compare({ plan, usual, end }: { plan: Plan; usual: UsualPlan | null; end?: number }) {
  if (!usual) return null
  if (Math.round(plan.crowded) === 0 && Math.round(usual.crowded) === 0) {
    return (
      <div className="cmp cmp-still">
        <p className="cmp-sum">
          <span className="cmp-main">
            <span className="cmp-what">{T.what}</span>
            <span className="cmp-head">{T.never}</span>
          </span>
        </p>
      </div>
    )
  }
  const move = moveWords(plan.moving - usual.moving)
  const max = Math.max(plan.crowded, usual.crowded, 1)
  const diff = usual.crowded - plan.crowded
  const usualLate = end !== undefined && usual.finish > end
  const planClosed = plan.stops.filter((s) => s.closeOver).length
  const lose = usualLate ? T.usualLate(fmt(end!)) : usual.closed > planClosed ? T.usualClosed : T.longer(fmtDur(-diff))
  const parts = diff >= 10 ? (plan.crowded === 0 ? null : T.shorter(`${Math.min(99, Math.round((diff / usual.crowded) * 100))}%`)) : diff <= -10 ? lose : T.same
  const tone = diff >= 10 ? (parts ? 'win' : 'all') : diff <= -10 ? 'lose' : 'same'
  const bar = (label: string, m: number, mine: boolean) => (
    <span className={`cmp-row${mine ? ' mine' : ' usual'}`}>
      <span className="cmp-label">{label}</span>
      <span className="cmp-bar" aria-hidden="true">
        <span className="cmp-fill" style={{ width: `${(m / max) * 100}%` }} />
      </span>
      <span className={`cmp-value num${mine ? ' strong' : ''}`}>{fmtDur(m)}</span>
    </span>
  )
  return (
    <details className={`cmp cmp-${tone}`}>
      <summary className="cmp-sum">
        <span className="cmp-main">
          <span className="cmp-what">{T.what}</span>
          <span className="cmp-head">
            {parts === null ? (
              T.never
            ) : typeof parts === 'string' ? (
              parts
            ) : (
              <>
                {parts[0]}
                <strong className="cmp-big num">{parts[1]}</strong>
                {parts[2]}
              </>
            )}
          </span>
          <span className="cmp-bars">
            {bar(T.usual, usual.crowded, false)}
            {bar(T.plan, plan.crowded, true)}
          </span>
        </span>
      </summary>
      {move && (
        <p className="cmp-move num">
          {move[0]}
          <strong>{move[1]}</strong>
          {move[2]}
        </p>
      )}
      <p className="note">{T.about}</p>
    </details>
  )
}
