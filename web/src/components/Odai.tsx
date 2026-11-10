import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Text } from '@astryxdesign/core/Text'
import { useEffect, useRef, useState } from 'react'
import { GeminiMark } from './GeminiMark'
import type { Plan, Stop } from '../lib/planner'
import { LEVELS, MAX_AVOID, MAX_REROLLS, byGemini, makeOdai, odaiKind, pickStops, readTrip, shrinkPhoto, tryOdai, useTripOdai, type OdaiItem, type OdaiLevel, type TripOdai as Trip } from '../lib/odai'
import { joinNames, tr } from '../lib/i18n'

const T = tr({
  ja: {
    noRoom: '端末の空きが足りないため、ミッションを保存できませんでした',
    noStop: 'ミッションを出せる場所がプランにありません',
    badPhoto: 'この写真は読み込めません',
    moved: (names: string) => `ミッションを${names}に移しました`,
    sep: '・',
    thinking: '考えています……',
    outOfPlan: 'この場所はプランから外れています。',
    alt: (t: string) => `ミッションの写真: ${t}`,
    retake: '撮り直す',
    take: '写真を撮る',
    early: '当日にここから撮れます',
    moveIn: 'プランの場所に移す',
    another: (n: number) => `別のミッションにする（あと${n}回）`,
    nextLevel: '次のミッションの難しさ',
    firstLevel: 'ミッションの難しさ',
    saved: 'ミッションを記録しました。',
    title: '旅のミッション',
    about: '旅のどこかで、1 つの物をじっくり見て 1 枚撮るミッションを出します。',
    geminiThinking: 'Gemini が考えています……',
    getN: (n: number) => `ミッションを${n}つ出す`,
    get: 'ミッションを出す',
    oneMore: 'ミッションをもう1つ出す',
  },
  en: {
    noRoom: 'Not enough storage to save the mission',
    noStop: 'No places in the plan for a mission',
    badPhoto: 'This photo can’t be loaded',
    moved: (names: string) => `Moved the mission to ${names}`,
    sep: '\u00a0· ',
    thinking: 'Thinking…',
    outOfPlan: 'This place is no longer in the plan.',
    alt: (t: string) => `Mission photo: ${t}`,
    retake: 'Retake',
    take: 'Take Photo',
    early: 'You can take it here on the day',
    moveIn: 'Move to a Plan Stop',
    another: (n: number) => `Try Another (${n} left)`,
    nextLevel: 'Difficulty of the next mission',
    firstLevel: 'Mission difficulty',
    saved: 'Mission saved.',
    title: 'Photo Mission',
    about: 'Get a mission to look closely at one thing on your trip and take one photo.',
    geminiThinking: 'Gemini is thinking…',
    getN: (n: number) => `Get ${n} Missions`,
    get: 'Get a Mission',
    oneMore: 'Get One More',
  },
})

// ミッションを出す・出し直す・写真を記録する（プランの画面と場所の画面で同じものを使う）。
// ミッションはエリアごとに取ってあるので、since（この旅を作り始めた時刻）より後の分だけを、この旅のミッションとして扱う。
// それより前の分（前の旅のミッションと写真）は消さずに、書き込むときもそのまま残す
function useOdai(area: string, date: string, plan: Plan, since: number, onNotice: (text: string) => void) {
  const [all, save] = useTripOdai(area)
  const [busy, setBusy] = useState<number | 'all' | null>(null)
  const mine = (x: OdaiItem) => x.at >= since
  const before = all.items.filter((x) => !mine(x))
  const trip: Trip = { items: all.items.filter(mine) }
  const keep = (items: OdaiItem[]) => {
    if (!save({ items: [...before, ...items] })) onNotice(T.noRoom)
  }
  const store = (items: OdaiItem[]) => {
    if (!save({ items })) onNotice(T.noRoom)
  }
  // 保存先の今のミッションから、spotId と at が合う 1 件だけを差し替える（合う物が無ければ保存しない）
  const swap = (it: OdaiItem, f: (x: OdaiItem) => OdaiItem) => {
    const items = readTrip(area).items
    const j = items.findIndex((x) => x.spotId === it.spotId && x.at === it.at)
    if (j >= 0) store(items.map((x, k) => (k === j ? f(x) : x)))
  }
  const itemFor = async (stop: Stop, level: OdaiLevel, past: string[] = []): Promise<OdaiItem> => ({
    spotId: stop.spot.id,
    spotName: stop.spot.name,
    kind: odaiKind(stop.spot),
    text: await makeOdai(area, date, stop, level, past),
    level,
    rerolls: 0,
    past,
    at: Date.now(),
  })
  const add = async (n: number, level: OdaiLevel) => {
    const used = trip.items.map((x) => x.spotId)
    const stops = pickStops(plan, n, used, trip.items.map((x) => x.kind))
    if (!stops.length) return onNotice(T.noStop)
    setBusy('all')
    const made = await Promise.all(stops.map((s) => itemFor(s, level)))
    const now = readTrip(area).items
    const taken = new Set(now.filter(mine).map((x) => x.spotId))
    store([...now, ...made.filter((x) => !taken.has(x.spotId))])
    setBusy(null)
  }
  const reroll = async (i: number, level?: OdaiLevel) => {
    const it = trip.items[i]
    if (!it) return
    const here = plan.stops.find((s) => s.spot.id === it.spotId)
    if (!here && it.photo) return
    const stop = here ?? pickStops(plan, 1, trip.items.map((x) => x.spotId))[0]
    if (!stop) return onNotice(T.noStop)
    if (here && it.rerolls >= MAX_REROLLS) return
    setBusy(i)
    const past = here ? [...(it.past ?? []), it.text].slice(-MAX_AVOID) : []
    const next = await itemFor(stop, level ?? it.level, past)
    swap(it, (x) => (x.photo ? x : { ...next, rerolls: here ? it.rerolls + 1 : it.rerolls }))
    setBusy(null)
  }
  const photo = async (i: number, file: File | undefined) => {
    const it = trip.items[i]
    if (!file || !it) return
    try {
      const p = await shrinkPhoto(file)
      swap(it, (x) => ({ ...x, photo: p }))
    } catch {
      onNotice(T.badPhoto)
    }
  }
  return { trip, busy, keep, add, reroll, photo }
}

// 見せるミッションの番号。写真を撮った、プランから外れた場所のミッションは記録として残し、設定の数には数えない
function shownOdai(items: OdaiItem[], plan: Plan, count: number): { shown: number[]; active: number } {
  const ids = new Set(plan.stops.map((s) => s.spot.id))
  const keep = items.map((_, i) => i).filter((i) => ids.has(items[i].spotId) || !items[i].photo).slice(0, count)
  const records = items.map((_, i) => i).filter((i) => !ids.has(items[i].spotId) && !!items[i].photo)
  return { shown: [...keep, ...records].sort((a, b) => a - b), active: keep.length }
}

const MOVE_WAIT = 1500
const odaiKey = (x: OdaiItem) => `${x.spotId}:${x.at}`
const idsOf = (plan: Plan) => plan.stops.map((s) => s.spot.id)

// プランから外れた場所の、写真の無いミッションを、プランの中のミッションの無い場所へ移す。
// プランが続けて変わったときは落ち着くまで待ち、1 回の変化につき 1 度だけ聞く。失敗したら外れたままにする。
// 「元に戻す」でプランが移す前と同じ場所の並びに戻ったら、移したミッションも元に戻す
function useMoveOdai(area: string, date: string, plan: Plan, count: number, trip: Trip, keep: (items: OdaiItem[]) => void, onNotice: (t: string) => void) {
  const [moving, setMoving] = useState<string[]>([])
  const latest = useRef({ area, date, plan, count, trip, keep, onNotice })
  latest.current = { area, date, plan, count, trip, keep, onNotice }
  const tried = useRef(new Set<string>())
  const lastIn = useRef(new Map<string, string>())
  const back = useRef(new Map<string, { from: OdaiItem; ids: string }>())
  const running = useRef(false)
  const again = useRef(false)

  const sig = idsOf(plan).join(',')
  const keys = trip.items.map(odaiKey).join(',')
  useEffect(() => {
    const ids = new Set(sig.split(','))
    const set = [...ids].sort().join(',')
    for (const x of latest.current.trip.items) if (ids.has(x.spotId)) lastIn.current.set(odaiKey(x), set)
  }, [sig, keys])

  useEffect(() => {
    const run = async () => {
      if (running.current) {
        again.current = true
        return
      }
      const { area, date, plan, count, trip, keep } = latest.current
      const sig = idsOf(plan).join(',')
      const ids = new Set(idsOf(plan))
      const set = [...ids].sort().join(',')
      const items = trip.items
      const used = new Set(items.map((x) => x.spotId))
      const restored = items.map((x) => {
        const b = back.current.get(odaiKey(x))
        if (!b || x.photo || b.ids !== set || used.has(b.from.spotId)) return x
        back.current.delete(odaiKey(x))
        used.add(b.from.spotId)
        return b.from
      })
      if (restored.some((x, i) => x !== items[i])) return keep(restored)
      const { shown } = shownOdai(items, plan, count)
      const todo = shown.filter((i) => !ids.has(items[i].spotId) && !items[i].photo && !tried.current.has(`${area}|${odaiKey(items[i])}|${sig}`))
      if (!todo.length) return
      for (const i of todo) tried.current.add(`${area}|${odaiKey(items[i])}|${sig}`)
      const kinds = shown.filter((i) => !todo.includes(i)).map((i) => items[i].kind)
      const pairs = pickStops(plan, todo.length, [...used], kinds).map((stop, k) => ({ from: items[todo[k]], stop }))
      if (!pairs.length) return
      running.current = true
      setMoving(pairs.map((p) => odaiKey(p.from)))
      const texts = await Promise.all(pairs.map((p) => tryOdai(area, date, p.stop, p.from.level)))
      running.current = false
      setMoving([])
      const now = latest.current
      if (now.area === area) {
        const nowIds = new Set(idsOf(now.plan))
        const taken = new Set(now.trip.items.map((x) => x.spotId))
        let next = now.trip.items
        const moved: string[] = []
        pairs.forEach(({ from, stop }, k) => {
          const text = texts[k]
          const j = next.findIndex((x) => odaiKey(x) === odaiKey(from))
          if (!text || j < 0 || next[j].photo || nowIds.has(from.spotId) || !nowIds.has(stop.spot.id) || taken.has(stop.spot.id)) return
          const it: OdaiItem = { spotId: stop.spot.id, spotName: stop.spot.name, kind: odaiKind(stop.spot), text, level: from.level, rerolls: from.rerolls, past: [], at: Date.now() }
          taken.add(stop.spot.id)
          const was = lastIn.current.get(odaiKey(from))
          if (was) back.current.set(odaiKey(it), { from, ids: was })
          next = next.map((x, n) => (n === j ? it : x))
          moved.push(stop.spot.name)
        })
        if (moved.length) {
          now.keep(next)
          now.onNotice(T.moved(joinNames(moved)))
        }
      }
      if (again.current) {
        again.current = false
        void run()
      }
    }
    const t = window.setTimeout(run, MOVE_WAIT)
    return () => window.clearTimeout(t)
  }, [area, sig, keys, count])
  return moving
}

// プランの画面では「03 西福寺・やさしい」（番号は旅程と同じ）、場所の画面では難しさだけを出す
function OdaiEntry({ item, busy, inPlan, no, showPlace, early, onReroll, onPhoto, onOpen }: { item: OdaiItem; busy: boolean; inPlan: boolean; no?: number; showPlace: boolean; early: boolean; onReroll: (level: OdaiLevel) => void; onPhoto: (f: File | undefined) => void; onOpen?: () => void }) {
  const left = MAX_REROLLS - item.rerolls
  const [pick, setPick] = useState<OdaiLevel>(item.level)
  const level = LEVELS.find((l) => l.key === item.level)?.label
  return (
    <div className="odai-item">
      <p className="odai-where">
        {showPlace && no !== undefined && <span className="badge num">{no}</span>}
        {showPlace &&
          (onOpen ? (
            <button type="button" className="odai-place" onClick={onOpen}>
              {item.spotName}
            </button>
          ) : (
            <span className="odai-place">{item.spotName}</span>
          ))}
        <span className="muted">
          {showPlace ? T.sep : ''}
          {level}
        </span>
      </p>
      <p className="odai-text">
        {busy ? (
          T.thinking
        ) : (
          <>
            {byGemini(item) && <GeminiMark />}
            {item.text}
          </>
        )}
      </p>
      {!inPlan && <p className={item.photo ? 'note' : 'note warn'}>{T.outOfPlan}</p>}
      {item.photo && <img className="odai-photo" src={item.photo} alt={T.alt(item.text)} />}
      <div className="odai-actions">
        <label className="btn-primary file">
          {item.photo ? T.retake : T.take}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => {
              onPhoto(e.target.files?.[0])
              e.target.value = ''
            }} />
        </label>
        {early && !item.photo && <span className="note odai-early">{T.early}</span>}
        {!item.photo && !inPlan && (
          <Button variant="ghost" label={T.moveIn} isDisabled={busy} onClick={() => onReroll(item.level)} />
        )}
        {!item.photo && inPlan && left > 0 && (
          <>
            <Text as="p" display="block" type="supporting" className="note odai-level-label" aria-hidden="true">
              {T.nextLevel}
            </Text>
            <SegmentedControl value={pick} onChange={(v) => setPick(v as OdaiLevel)} label={T.nextLevel} layout="fill" isDisabled={busy} className="odai-level">
              {LEVELS.map((l) => (
                <SegmentedControlItem key={l.key} value={l.key} label={l.label} />
              ))}
            </SegmentedControl>
            <Button variant="secondary" className="odai-another" label={T.another(left)} isDisabled={busy} onClick={() => onReroll(pick)} />
          </>
        )}
      </div>
      {item.photo && <p className="note">{T.saved}</p>}
    </div>
  )
}

// プランの画面の「旅のミッション」（旅全体で設定の数まで。数は調整の画面の「その他の設定」で選ぶ。
// 難しさは、最初のミッションを出す前にここでも選べる（調整の画面と同じ設定）
export function TripOdai({ area, date, plan, count, level, since, early, onLevel, onOpen, onNotice }: { area: string; date: string; plan: Plan; count: number; level: OdaiLevel; since: number; early: boolean; onLevel: (l: OdaiLevel) => void; onOpen: (id: string) => void; onNotice: (t: string) => void }) {
  const { trip, busy, keep, add, reroll, photo } = useOdai(area, date, plan, since, onNotice)
  const moving = useMoveOdai(area, date, plan, count, trip, keep, onNotice)
  const order = new Map(plan.stops.map((s, i) => [s.spot.id, i + 1]))
  const { shown, active } = shownOdai(trip.items, plan, count)
  // プランの画面では閉じて出し、見出しを押すと開く
  const [open, setOpen] = useState(false)
  return (
    <section className="odai odai-fold" aria-labelledby="odai-title" data-open={open || undefined}>
      <Heading level={2} className="sec-title">
        <button type="button" id="odai-title" className="odai-toggle" aria-expanded={open} aria-controls="odai-body" onClick={() => setOpen(!open)}>
          {T.title}
        </button>
      </Heading>
      <div className="odai-body" id="odai-body" hidden={!open}>
        {shown.length === 0 ? (
          <>
            <Text as="p" display="block" type="supporting" className="note">
              {T.about}
            </Text>
            <Text as="p" display="block" type="supporting" className="note odai-level-label" aria-hidden="true">
              {T.firstLevel}
            </Text>
            <SegmentedControl value={level} onChange={(v) => onLevel(v as OdaiLevel)} label={T.firstLevel} layout="fill" isDisabled={busy !== null} className="odai-level">
              {LEVELS.map((l) => (
                <SegmentedControlItem key={l.key} value={l.key} label={l.label} />
              ))}
            </SegmentedControl>
            <Button
              variant="secondary"
              size="lg"
              width="100%"
              className="odai-get"
              label={busy !== null ? T.geminiThinking : count > 1 ? T.getN(count) : T.get}
              isDisabled={busy !== null}
              onClick={() => add(count, level)}
            />
          </>
        ) : (
          <>
            {shown.map((i) => {
              const it = trip.items[i]
              return <OdaiEntry key={it.spotId + it.at} item={it.spotName ? it : { ...it, spotName: plan.stops.find((s) => s.spot.id === it.spotId)?.spot.name ?? '' }} busy={busy === i || busy === 'all' || moving.includes(odaiKey(it))} inPlan={order.has(it.spotId)} no={order.get(it.spotId)} showPlace early={early} onReroll={(l) => reroll(i, l)} onPhoto={(f) => photo(i, f)} onOpen={order.has(it.spotId) ? () => onOpen(it.spotId) : undefined} />
            })}
            {active < count && (
              <Button
                variant="secondary"
                size="lg"
                width="100%"
                label={busy === 'all' ? T.geminiThinking : T.oneMore}
                isDisabled={busy !== null || moving.length > 0}
                onClick={() => add(count - active, trip.items[shown[0]]?.level ?? level)}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

// 場所の画面：その場所にミッションが出ていれば見せる
export function StopOdai({ area, date, plan, stop, count, since, early, onNotice }: { area: string; date: string; plan: Plan; stop: Stop; count: number; since: number; early: boolean; onNotice: (t: string) => void }) {
  const { trip, busy, reroll, photo } = useOdai(area, date, plan, since, onNotice)
  const i = shownOdai(trip.items, plan, count).shown.find((j) => trip.items[j].spotId === stop.spot.id)
  if (i === undefined) return null
  return (
    <section className="odai" aria-labelledby="odai-stop-title">
      <Heading level={3} id="odai-stop-title" className="sec-title">
        {T.title}
      </Heading>
      <OdaiEntry item={trip.items[i]} busy={busy === i} inPlan showPlace={false} early={early} onReroll={(l) => reroll(i, l)} onPhoto={(f) => photo(i, f)} />
    </section>
  )
}
