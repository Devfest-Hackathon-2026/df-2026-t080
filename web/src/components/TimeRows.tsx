import { useEffect, useId, useRef, useState } from 'react'
import { isoDate } from '../lib/time'
import { tr } from '../lib/i18n'

const T = tr({
  ja: {
    date: '日付',
    start: '出発',
    now: '今から',
    end: '帰る時刻',
    arrive: '到着',
    from: (n: string) => `${n}から出発し、${n}に戻ります。`,
    oneWay: (a: string, b: string) => `${a}から出発し、${b}まで行きます。`,
    fromCenter: 'エリアの中心の駅から出発し、同じ駅に戻ります。',
    leeway: '早めに帰ってもいい時刻',
    leewayArrive: '早めに着いてもいい時刻',
    leewayRange: (a: string, b: string) => `${a}〜${b}の間に帰るプランにします。`,
    leewayRangeArrive: (a: string, b: string) => `${a}〜${b}の間に着くプランにします。`,
    leewayNone: (t: string) => `帰る時刻（${t}）まで使うプランにします。`,
    leewayNoneArrive: (t: string) => `到着の時刻（${t}）まで使うプランにします。`,
    past: '今日より前の日付は選べません。',
    after: (t: string) => `出発から1時間以上あけて、${t}以降にしてください。`,
    before: (t: string) => `${t}までにしてください。`,
    range: (a: string, b: string) => `${a}〜${b}にしてください。`,
    moved: (t: string) => `出発に合わせて${t}にしました。`,
  },
  en: {
    date: 'Date',
    start: 'Leave',
    now: 'Now',
    end: 'Back by',
    arrive: 'Arrive',
    from: (n: string) => `Start and end at ${n}.`,
    oneWay: (a: string, b: string) => `Start at ${a} and end at ${b}.`,
    fromCenter: 'Start and end at the main station of the area.',
    leeway: 'Earliest okay to be back',
    leewayArrive: 'Earliest okay to arrive',
    leewayRange: (a: string, b: string) => `Plans will get you back between ${a} and ${b}.`,
    leewayRangeArrive: (a: string, b: string) => `Plans will get you there between ${a} and ${b}.`,
    leewayNone: (t: string) => `Plans will use the time until ${t}.`,
    leewayNoneArrive: (t: string) => `Plans will use the time until ${t}.`,
    past: 'Choose today or a later date.',
    after: (t: string) => `Choose ${t} or later (at least 1 hour after you leave).`,
    before: (t: string) => `Choose ${t} or earlier.`,
    range: (a: string, b: string) => `Choose a time from ${a} to ${b}.`,
    moved: (t: string) => `Moved to ${t} to follow your leave time.`,
  },
})

// 出発は 5:00〜22:00、戻りは出発の 1 時間後〜23:55（1 分単位。iPhone では時と分を回して選ぶ）
export const START_MIN = 5 * 60
export const START_MAX = 22 * 60
export const END_MAX = 23 * 60 + 55
export const MIN_SPAN = 60

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const parse = (v: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type Props = {
  date: string
  start: number
  end: number
  onDate: (v: string) => void
  onStart: (v: number) => void
  onEnd: (v: number) => void
  idPrefix: string
  // 出発地と到着地の名前（到着地が無ければ出発地に戻る。出発地がまだ分からないときは null。undefined なら一言を出さない）
  startName?: string | null
  endName?: string | null
  // 出発地に戻らない旅（最後の時刻を「到着」と呼ぶ）
  oneWay?: boolean
  // 欄ごとの、反映できない日付・時刻が入っているか（id と、入っていれば true）
  onInvalid?: Invalid
}

type Invalid = (id: string, bad: boolean) => void

// 欄に反映できない値が入っている間を知らせる（欄が消えたら、入っていないことにする）
function useInvalid(id: string, bad: boolean, onInvalid?: Invalid) {
  useEffect(() => {
    onInvalid?.(id, bad)
  }, [id, bad, onInvalid])
  useEffect(() => () => onInvalid?.(id, false), [id, onInvalid])
}

// 日付・出発・戻り（片道は到着）。戻りの欄に出る時刻と、プランに使う時刻はいつも同じにする
export function TimeRows({ date, start, end, onDate, onStart, onEnd, idPrefix, startName, endName, oneWay, onInvalid }: Props) {
  // 出発に合わせて戻りの時刻を動かしたときの、動かした先の時刻
  const [moved, setMoved] = useState<number | null>(null)
  const setStart = (v: number) => {
    const s = clamp(Math.round(v), START_MIN, START_MAX)
    onStart(s)
    if (end < s + MIN_SPAN) {
      const e = Math.min(END_MAX, s + MIN_SPAN)
      onEnd(e)
      setMoved(e)
    }
  }
  const setEnd = (v: number) => {
    setMoved(null)
    onEnd(clamp(Math.round(v), Math.min(END_MAX, start + MIN_SPAN), END_MAX))
  }
  const endMin = Math.min(END_MAX, start + MIN_SPAN)
  const today = date === isoDate(new Date())
  const fromNow = () => {
    const d = new Date()
    setStart(Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5)
  }
  return (
    <div className="when">
      <div className="field when-date">
        <label htmlFor={`${idPrefix}-date`}>{T.date}</label>
        <DateField id={`${idPrefix}-date`} value={date} onDate={onDate} onInvalid={onInvalid} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-start`}>{T.start}</label>
        <TimeField id={`${idPrefix}-start`} name="start" value={start} min={START_MIN} max={START_MAX} onCommit={setStart} early={T.range(hhmm(START_MIN), hhmm(START_MAX))} late={T.range(hhmm(START_MIN), hhmm(START_MAX))} onInvalid={onInvalid} />
        {today && (
          <button type="button" className="btn-quiet now-btn" onClick={fromNow}>
            {T.now}
          </button>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-end`}>{oneWay ? T.arrive : T.end}</label>
        <TimeField
          id={`${idPrefix}-end`}
          name="end"
          value={end}
          min={endMin}
          max={END_MAX}
          onCommit={setEnd}
          early={T.after(hhmm(endMin))}
          late={T.before(hhmm(END_MAX))}
          note={moved === end ? T.moved(hhmm(end)) : undefined}
          onInvalid={onInvalid}
        />
      </div>
      {startName !== undefined && (
        <p className="note when-note">{startName ? (endName ? T.oneWay(startName, endName) : T.from(startName)) : T.fromCenter}</p>
      )}
    </div>
  )
}

// 早めに帰ってもいい時刻。出発・帰る時刻と同じく回して選ぶ（出発の 1 時間後〜帰る時刻）。帰る時刻と同じなら、帰る時刻まで使う。
// 中では、帰る時刻より早く終わってもよい分（value）として持つ
export function LeewayField({ start, end, value, onChange, oneWay, onInvalid }: { start: number; end: number; value: number; onChange: (v: number) => void; oneWay?: boolean; onInvalid?: Invalid }) {
  const id = useId()
  const min = Math.min(end, start + MIN_SPAN)
  const at = clamp(end - value, min, end)
  return (
    <div className="field when-leeway">
      <label htmlFor={id}>{oneWay ? T.leewayArrive : T.leeway}</label>
      <TimeField
        id={id}
        name="leeway"
        value={at}
        min={min}
        max={end}
        onCommit={(t) => onChange(end - clamp(Math.round(t), min, end))}
        early={T.after(hhmm(min))}
        late={T.before(hhmm(end))}
        onInvalid={onInvalid}
      />
      <p className="note">
        {at < end
          ? (oneWay ? T.leewayRangeArrive : T.leewayRange)(hhmm(at), hhmm(end))
          : (oneWay ? T.leewayNoneArrive : T.leewayNone)(hhmm(end))}
      </p>
    </div>
  )
}

// 日付の欄。今日より前の日付は反映せず、欄の下にわけを出す（開いた旅がもとから前の日付なら、触るまでは出さない）
function DateField({ id, value, onDate, onInvalid }: { id: string; value: string; onDate: (v: string) => void; onInvalid?: Invalid }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const today = isoDate(new Date())
  const error = draft !== value && /^\d{4}-\d{2}-\d{2}$/.test(draft) && draft < today
  useInvalid(id, error, onInvalid)
  return (
    <>
      <input
        id={id}
        name="date"
        type="date"
        min={today}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-note` : undefined}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          if (v && v >= today) onDate(v)
        }}
        onBlur={() => {
          if (!draft) setDraft(value)
        }}
      />
      {error && (
        <p id={`${id}-note`} className="note time-note warn" role="alert">
          {T.past}
        </p>
      )}
    </>
  )
}

type FieldProps = {
  id: string
  name: string
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
  // 範囲より前・後の時刻を入れたときに、欄の下に出す文
  early: string
  late: string
  // ふだん欄の下に出す一言（選べる範囲など）
  note?: string
  onInvalid?: Invalid
}

// 時刻の欄。範囲の中の時刻はすぐ反映する。範囲の外の時刻は反映せず、欄の下にわけを出す（入れた時刻は欄に残す）。
// 範囲の外のまま欄を離れたら、打っている途中に反映した時刻も、欄に入る前の時刻に戻す
function TimeField({ id, name, value, min, max, onCommit, early, late, note, onInvalid }: FieldProps) {
  const [draft, setDraft] = useState(hhmm(value))
  const before = useRef<number | null>(null)
  const keepDraft = useRef(false)
  useEffect(() => {
    if (keepDraft.current) keepDraft.current = false
    else setDraft(hhmm(value))
  }, [value])
  const v = parse(draft)
  const error = v === null ? null : v < min ? early : v > max ? late : null
  useInvalid(id, !!error, onInvalid)
  useEffect(() => {
    if (v !== null && v >= min && v <= max && v !== value) onCommit(v)
    // 範囲が変わって、入れてあった時刻が範囲に入ったときだけ反映する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max])
  const text = error ?? note
  return (
    <>
      <input
        id={id}
        name={name}
        type="time"
        min={hhmm(min)}
        max={hhmm(max)}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={text ? `${id}-note` : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = parse(e.target.value)
          if (n !== null && n >= min && n <= max) onCommit(n)
        }}
        onFocus={() => {
          before.current = value
        }}
        onBlur={() => {
          const b = before.current
          before.current = null
          if (v === null) setDraft(hhmm(value))
          else if (error && b !== null && b !== value) {
            keepDraft.current = true
            onCommit(b)
          }
        }}
      />
      {text && (
        <p id={`${id}-note`} className={error ? 'note time-note warn' : 'note time-note'} role={error ? 'alert' : undefined}>
          {text}
        </p>
      )}
    </>
  )
}
