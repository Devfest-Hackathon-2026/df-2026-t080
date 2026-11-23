import { Button } from '@astryxdesign/core/Button'
import { TextArea } from '@astryxdesign/core/TextArea'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { distM } from '../lib/geo'
import { tr } from '../lib/i18n'
import { nextDate } from '../lib/days'
import { placeLabel, type PlaceField } from '../lib/placeField'
import { FAR_TEXT, MAX_TRIP_KM, stayFarTexts } from '../lib/stayFar'
import { canSkip, stayRuns, talkDays, type Question, type Talk } from '../lib/stayTalk'
import { fmt } from '../lib/time'
import { PenguinMark } from './CrowdMark'
import { DAY_TEXT, rangeLabel } from './DayTabs'

const T = tr({
  ja: {
    q: {
      start: 'どんな旅にしますか？',
      where: 'どこへ行きますか？',
      nights: '何泊しますか？',
      date: 'いつ出発しますか？',
      stay: '泊まる宿は決まっていますか？',
      wish: '行きたい場所や、したいことはありますか？',
      time: '1日目は何時ごろ出発して、最終日は何時ごろ帰りますか？',
      done: 'この内容で候補を検索できます。',
    } as Record<Question, string>,
    check: '下の場所を確認してください。',
    startHint: '行き先、日数、泊まる宿、行きたい場所など、決まっていることを書いてください。',
    doneHint: '直したい所があれば、続けて書いてください。',
    over: '3泊4日までの旅を作成できます。',
    box: '旅の内容',
    placeholder: '京都に2泊3日。1泊目は四条、2泊目は嵐山に泊まる。静かな寺を回りたい',
    send: '送信',
    skip: 'スキップ',
    reading: 'Gemini が読み取っています……',
    sum: '旅のまとめ',
    from: '行き先',
    dates: '日程',
    stay: '宿',
    wishes: '希望',
    nth: (n: number) => `${n}日目`,
    night: (a: number, b: number) => (a === b ? `${a}泊目` : `${a}〜${b}泊目`),
    end: '観光を終える場所',
    leave: (t: string) => `${t}に出発`,
    toStay: (t: string) => `${t}までに宿に到着`,
    back: (t: string) => `${t}までに帰る`,
    arrive: (t: string) => `${t}までに到着`,
    join: '・',
    looking: '場所を検索しています……',
    miss: '場所が見つかりませんでした。近くの駅名か地名を続けて書いてください。',
    lookFailed: '場所を確認できませんでした。',
    manual: '自分で入力',
  },
  en: {
    q: {
      start: 'What kind of trip are you planning?',
      where: 'Where are you going?',
      nights: 'How many nights are you staying?',
      date: 'When are you leaving?',
      stay: 'Have you decided where to stay?',
      wish: 'Are there places you want to visit or things you want to do?',
      time: 'What time will you leave on day 1, and when will you be back on the last day?',
      done: 'You’re ready to find places.',
    },
    check: 'Check the places below.',
    startHint: 'Write what you’ve decided, like where you’re going, how many nights, where you’re staying, and places you want to visit.',
    doneHint: 'To change anything, keep writing.',
    over: 'Trips can be up to 3 nights.',
    box: 'Your Trip',
    placeholder: 'Kyoto for 2 nights. Night 1 in Shijo, night 2 in Arashiyama. Quiet temples',
    send: 'Send',
    skip: 'Skip',
    reading: 'Gemini is reading…',
    sum: 'Trip Summary',
    from: 'Destination',
    dates: 'Dates',
    stay: 'Lodging',
    wishes: 'Wishes',
    nth: (n: number) => `Day ${n}`,
    night: (a: number, b: number) => (a === b ? `Night ${a}` : `Nights ${a}–${b}`),
    end: 'End Sightseeing At',
    leave: (t: string) => `Leave at ${t}`,
    toStay: (t: string) => `Arrive at lodging by ${t}`,
    back: (t: string) => `Back by ${t}`,
    arrive: (t: string) => `Arrive by ${t}`,
    join: ' · ',
    looking: 'Finding the place…',
    miss: 'Couldn’t find this place. Write a nearby station or area name.',
    lookFailed: 'Couldn’t check this place.',
    manual: 'Enter Manually',
  },
})

export const TALK_MAX = 300

type Props = {
  talk: Talk
  question: Question
  // 直前に送った文
  last: string
  busy: boolean
  // 候補を検索している（箱とボタンを押せなくする）
  searching: boolean
  error: string
  from: PlaceField
  to: PlaceField
  // 宿の欄（毎晩同じ宿なら 1 つ目だけ使う）
  stays: PlaceField[]
  sameStay: boolean
  // 出発の日付（showDate: まとめに日付を出す。日付を書いたか、日付の問いをスキップしたとき）
  date: string
  showDate: boolean
  // 見つからない・離れすぎの場所があって、候補を検索できない
  blocked: boolean
  onSend: (text: string) => Promise<boolean>
  onSkip: () => void
  onManual: () => void
  // 旅のまとめの下に出す物（車で回るかのスイッチ）
  after?: ReactNode
}

// 泊まりの旅を 1 行の文から作る画面の、問いかけ・入力の箱・旅のまとめ
export function StayTalk(p: Props) {
  const [text, setText] = useState('')
  const q = p.question
  const check = q === 'done' && p.blocked
  const hint = p.talk.over ? T.over : q === 'start' ? T.startHint : q === 'done' && !check ? T.doneHint : ''
  const send = async () => {
    const t = text.trim()
    if (!t || p.busy || p.searching) return
    if (await p.onSend(t)) setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLFormElement>) => {
    if (!(e.target instanceof HTMLTextAreaElement) || e.key !== 'Enter' || e.shiftKey) return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void send()
  }
  return (
    <>
      <section className="field talk-ask" aria-labelledby="talk-q">
        {p.last && <p className="talk-last">{p.last}</p>}
        <div className="talk-q">
          <PenguinMark size={26} />
          <div className="talk-q-text" aria-live="polite">
            <h2 id="talk-q" className="talk-title">
              {check ? T.check : T.q[q]}
            </h2>
            {hint && <p className="talk-hint">{hint}</p>}
          </div>
        </div>
        <form
          className="talk-row"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
          onKeyDown={onKey}
        >
          <TextArea containerClassName="talk-text" label={T.box} isLabelHidden htmlName="talk" rows={2} value={text} isReadOnly={p.busy} isDisabled={p.searching} placeholder={q === 'start' ? T.placeholder : undefined} onChange={(v) => setText(v.slice(0, TALK_MAX))} />
          <Button type="submit" variant={q === 'done' ? 'secondary' : 'primary'} label={T.send} isDisabled={p.busy || p.searching || !text.trim()} />
        </form>
        <div className="talk-foot">
          <div className="talk-foot-main" aria-live="polite">
            {p.busy ? (
              <p className="note pulse">{T.reading}</p>
            ) : p.error ? (
              <p className="error" role="alert">
                {p.error}
              </p>
            ) : (
              canSkip(q) && <Button variant="ghost" size="sm" className="talk-skip" label={T.skip} isDisabled={p.searching} onClick={p.onSkip} />
            )}
          </div>
          <Button variant="ghost" size="sm" className="talk-manual" label={T.manual} isDisabled={p.searching} onClick={p.onManual} />
        </div>
      </section>
      <Summary {...p} />
      {p.after}
    </>
  )
}

type Line = { key: string; label: string; value: string; sub?: string; note?: { text: string; warn: boolean } }

// 場所の行の値と一言（引けた場所は「◯◯（京都府京都市）」）
function place(f: PlaceField): Pick<Line, 'value' | 'note'> {
  const value = f.hit ? placeLabel(f.hit) : f.text.trim()
  if (f.state === 'finding') return { value, note: { text: T.looking, warn: false } }
  if (f.state === 'miss') return { value, note: { text: T.miss, warn: true } }
  if (f.state === 'error') return { value, note: { text: T.lookFailed, warn: true } }
  return { value }
}

// 旅のまとめ（分かっている行だけ）
function Summary(p: Props) {
  const t = p.talk
  const n = talkDays(t)
  const nights = t.nights ?? 0
  const lines: Line[] = []
  if (t.from && p.from.text.trim()) lines.push({ key: 'from', label: T.from, ...place(p.from) })
  if (n || (p.showDate && p.date)) {
    const dates = p.showDate || t.date ? Array.from({ length: Math.max(n, 1) }, (_, k) => k).reduce<string[]>((a, k) => [...a, k ? nextDate(a[k - 1]) : p.date], []) : []
    lines.push({ key: 'dates', label: T.dates, value: [dates.length ? rangeLabel(dates) : '', nights ? DAY_TEXT.nights(nights) : ''].filter(Boolean).join(T.join) })
  }
  // 宿は、同じ宿が続く泊をまとめて 1 行ずつ。離れすぎは今の欄と同じ一言
  const runs = stayRuns(t.stays, Math.max(nights, t.stays?.length ?? 0))
  if (runs.length) {
    const fields = p.sameStay ? [p.stays[0]] : p.stays.slice(0, Math.max(nights, 1))
    const far = stayFarTexts(p.from.hit, fields.map((f) => (f.text.trim() ? f.hit : null)), t.end === undefined || t.end === null ? p.from.hit : p.to.hit, false)
    const all = runs.length === 1 && runs[0].from === 1 && runs[0].to === Math.max(nights, 1)
    runs.forEach((r, j) => {
      const at = p.sameStay ? 0 : r.from - 1
      const f = fields[at]
      const shown = f && f.text.trim() ? place(f) : { value: r.name }
      const warn = far[at]
      lines.push({ key: `stay-${r.from}`, label: j === 0 ? T.stay : '', value: shown.value, ...(!all && { sub: T.night(r.from, r.to) }), ...((warn || shown.note) && { note: warn ? { text: warn, warn: true } : shown.note }) })
    })
  }
  if (t.wish) lines.push({ key: 'wish', label: T.wishes, value: t.wish })
  const last = n ? n - 1 : -1
  ;(t.days ?? []).forEach((d, k) => {
    if (n && k >= n) return
    const times = [d.start !== undefined && T.leave(fmt(d.start)), d.end !== undefined && (k === last ? (typeof t.end === 'string' ? T.arrive : T.back) : T.toStay)(fmt(d.end))].filter(Boolean).join(T.join)
    if (!times && !d.wish) return
    lines.push({ key: `day-${k}`, label: T.nth(k + 1), value: times || (d.wish ?? ''), ...(times && d.wish && { note: { text: d.wish, warn: false } }) })
  })
  if (typeof t.end === 'string' && p.to.text.trim()) {
    const km = p.from.hit && p.to.hit ? Math.round(distM(p.from.hit, p.to.hit) / 1000) : 0
    const at = place(p.to)
    lines.push({ key: 'end', label: T.end, value: at.value, ...(km > MAX_TRIP_KM ? { note: { text: FAR_TEXT.far(km), warn: true } } : at.note && { note: at.note }) })
  }
  if (!lines.length) return null
  return (
    <section className="field talk-sum" aria-label={T.sum}>
      <dl className="talk-lines">
        {lines.map((l) => (
          <div key={l.key} className="talk-line" data-cont={l.label ? undefined : ''}>
            <dt>{l.label}</dt>
            <dd>
              <span className="talk-value num">
                {l.sub && <span className="talk-sub">{l.sub}</span>}
                {l.value}
              </span>
              {l.note && (
                <span className={l.note.warn ? 'talk-note warn' : 'talk-note'} {...(l.note.warn && { role: 'alert' })}>
                  {l.note.text}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
