import { useState, type ReactNode } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Heading } from '@astryxdesign/core/Heading'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import type { AreaData, Condition, Spot } from '../types'
import type { Pace } from '../lib/planner'
import { Sheet } from './Sheet'
import { LeewayField, TimeRows } from './TimeRows'
import { tr } from '../lib/i18n'
import { PenguinMark } from './CrowdMark'
import { type OdaiLevel } from '../lib/odai'
import { DAY_TEXT, DayCount } from './DayTabs'
import { StayFields } from './PlanForm'
import type { PlaceField } from '../lib/placeField'

// 地区の名前に代表の場所を 2 つまで添える（例: 洛北（金閣寺・詩仙堂））。見どころ・人気の順。名前が長いときは 1 つ
function districtLabel(d: string, places: Spot[]): string {
  const sightFirst = (s: Spot) => (s.kind === 'sight' || s.kind === 'street' ? 0 : 1)
  const top = places
    .filter((s) => s.district === d)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => sightFirst(a.s) - sightFirst(b.s) || (b.s.popularity ?? 0) - (a.s.popularity ?? 0) || (a.s.role === 'famous' ? 0 : 1) - (b.s.role === 'famous' ? 0 : 1) || a.i - b.i)
    .map((x) => x.s.name)
  const names = top.slice(0, 1)
  if (top[1] && top[0].length + top[1].length <= T.namesMax) names.push(top[1])
  return names.length ? T.district(d, names) : d
}

type Props = {
  data: AreaData
  conds: Condition[]
  date: string
  start: number
  end: number
  onConds: (c: Condition[]) => void
  onDate: (v: string) => void
  onStart: (v: number) => void
  onEnd: (v: number) => void
  onNew: () => void
  // 旅の日数（例のプランには出さない）。made: 作った日数、planned: 予定している日数、max: 選べる一番長い日数、
  // onAdd: 次の日を加える（加えられるときだけ）、onDelete: 開いている日を消す（何日かある旅だけ）
  days?: { made: number; planned: number; max: number; onPlanned: (n: number) => void; onAdd?: () => void; onDelete?: () => void }
  // これから作る日に効く泊の宿の欄（その泊があるときだけ）。nights: 泊の番号（fields と同じ順）、same: 毎晩同じ宿に泊まる、
  // far: 欄に出す泊ごとの離れすぎの一言
  stay?: { fields: PlaceField[]; nights: number[]; same: boolean; onSame: (v: boolean) => void; far: (string | null)[]; near?: string }
  // 開いている日の出発地・到着地が泊まる宿か
  stayEnds?: { from: boolean; to: boolean }
  // 開いている日が旅の何日目か（1 始まり）
  dayNo?: number
  onClose: () => void
  skipDistricts: string[]
  onSkipDistricts: (d: string[]) => void
  onPick: () => void
  // 頼みを送る。うまくいけば null、だめなら画面に出す文を返す。途中の様子は onStatus で知らせる
  onAsk: ((text: string, onStatus: (s: string) => void) => Promise<string | null>) | null
  odaiCount: number
  onOdaiCount: (n: number) => void
  leeway: number
  onLeeway: (v: number) => void
  odaiLevel: OdaiLevel
  onOdaiLevel: (v: OdaiLevel) => void
  pace: Pace
  // 移動を少なくする・混雑をもっと避ける（頼みや前の保存で入る。入っている間は条件の所に札を出し、押すと外せる）
  moveLess: boolean
  calm: boolean
  onMoveLess: (on: boolean) => void
  onCalm: (on: boolean) => void
  // 「回り方」のボタン。押すと、シートを開いたまま、その場でプランを組み直す
  onQuick: (what: 'many' | 'slow') => void
  // 車で回るか（例のプランには出さない）
  car?: { on: boolean; onChange: (on: boolean) => void }
}

const T = tr({
  ja: {
    namesMax: 14,
    district: (d: string, names: string[]) => `${d}（${names.join('・')}）`,
    thinking: 'Gemini が考えています……',
    sendFailed: 'Gemini に頼めませんでした。もう一度お試しください。',
    title: 'プランを変更',
    done: '完了',
    cancel: 'キャンセル',
    style: '回り方',
    many: 'もっと回りたい',
    slow: 'ゆっくり見たい',
    moveLess: '移動を少なく',
    calm: '混雑をもっと避ける',
    ask: 'Gemini に頼む',
    askHint: '移動を少なくしたい、早めに帰りたい、など',
    send: '送信',
    pick: '場所を追加・削除',
    missions: 'ミッション',
    leeway: '帰りのゆとり',
    join: '・',
    conds: '条件',
    districts: '回る地区',
    districtsNote: 'オフにした地区の場所は、プランに追加されません。',
    odai: '旅のミッションの数',
    odaiN: (n: number) => `${n}つ`,
    level: '旅のミッションの難しさ',
    create: '新しい旅を作成',
    car: '車で回る',
    none: '指定なし' as string,
    all: 'すべて' as string,
    skipN: (n: number) => `${n}地区をオフ`,
    when: '日時' as string,
    dayWhen: (n: number) => `${n}日目の日時`,
    dayTrip: '日帰り' as string,
  },
  en: {
    namesMax: 28,
    district: (d: string, names: string[]) => `${d} (${names.join(', ')})`,
    thinking: 'Gemini is thinking…',
    sendFailed: 'Couldn’t send your request. Please try again.',
    title: 'Edit Plan',
    done: 'Done',
    cancel: 'Cancel',
    style: 'Style',
    many: 'See More Places',
    slow: 'Take It Slow',
    moveLess: 'Less Travel',
    calm: 'Avoid More Crowds',
    ask: 'Ask Gemini',
    askHint: 'Less travel, an earlier return, and more',
    send: 'Send',
    pick: 'Add or Remove Places',
    missions: 'Missions',
    leeway: 'Return Time',
    join: ', ',
    conds: 'Conditions',
    districts: 'Districts',
    districtsNote: 'Places in districts you turn off won’t be in the plan.',
    odai: 'Photo Missions',
    odaiN: (n: number) => `${n}`,
    level: 'Mission Difficulty',
    create: 'Plan a New Trip',
    car: 'Get Around by Car',
    none: 'None',
    all: 'All',
    skipN: (n: number) => `${n} Off`,
    when: 'Date & Time',
    dayWhen: (n: number) => `Day ${n} Date & Time`,
    dayTrip: 'Day Trip',
  },
})

// 変えられる物の 1 行。名前の右に今の値を出し、押すとその場で開く
function Row({ name, value, open = false, children }: { name: string; value: string; open?: boolean; children: ReactNode }) {
  return (
    <Collapsible
      className="more"
      defaultIsOpen={open}
      trigger={
        <span className="more-label">
          <span className="more-name">{name}</span>
          <span className="more-sum num">{value}</span>
        </span>
      }
    >
      <div className="more-body">{children}</div>
    </Collapsible>
  )
}

export function AdjustSheet(p: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const counts = new Map<string, number>()
  p.data.places.forEach((s) => s.district && counts.set(s.district, (counts.get(s.district) ?? 0) + 1))
  // 2 件以上ある地区だけ（1 件しかない地区名は細かすぎる）
  const districts = [...counts.entries()].filter(([, n]) => n >= 2).map(([d]) => d)
  const active = new Set(p.conds.map((c) => c.tag))
  const toggleCond = (c: Condition) => p.onConds(active.has(c.tag) ? p.conds.filter((x) => x.tag !== c.tag) : [...p.conds, c])
  const allConds = [...p.data.conditions, ...p.conds.filter((c) => !p.data.conditions.some((x) => x.tag === c.tag))]
  // 開いたときに入っていた回り方の好みは、外したあとも札を残す（押し直して戻せるように）
  const [prefs] = useState(() => ({ moveLess: p.moveLess, calm: p.calm }))
  const hasConds = allConds.length > 0 || prefs.moveLess || prefs.calm
  // 泊まりの旅では、時刻が開いている日の物だと分かるように、見出しに何日目かを出す
  const staying = (p.days?.planned ?? 1) > 1
  // 行の右に出す今の値（押してある条件の名前・オフにした地区の数）
  const condNames = [p.moveLess && T.moveLess, p.calm && T.calm, ...allConds.filter((c) => active.has(c.tag)).map((c) => c.label)].filter((x): x is string => !!x)
  const skipped = districts.filter((d) => p.skipDistricts.includes(d)).length

  const send = async () => {
    const t = text.trim()
    if (!t || busy || !p.onAsk) return
    setBusy(true)
    setError('')
    setStatus(T.thinking)
    let err: string | null = null
    try {
      err = await p.onAsk(t, setStatus)
    } catch {
      err = T.sendFailed
    } finally {
      setBusy(false)
      setStatus('')
    }
    if (err) setError(err)
    else setText('')
  }

  return (
    <Sheet title={T.title} onClose={p.onClose} closeLabel={busy ? T.cancel : T.done}>
      {p.onAsk && (
        <section className="sheet-sec first ask panel-sec" aria-labelledby="ask-title">
          <Heading level={3} id="ask-title" className="sec-title">
            {T.ask}
          </Heading>
          <form
            className="ask-row"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
            onKeyDown={(e) => {
              if (e.target instanceof HTMLTextAreaElement && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
          >
            <PenguinMark />
            <TextArea containerClassName="ask-text" label={T.ask} isLabelHidden htmlName="ask" rows={2} value={text} isDisabled={busy} placeholder={T.askHint} onChange={setText} />
            <Button type="submit" variant="primary" label={T.send} isDisabled={busy || !text.trim()} />
          </form>
          <div aria-live="polite">
            {status && (
              <Text as="p" display="block" type="supporting" className="note pulse">
                {status}
              </Text>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="sheet-sec adjust-rows">
        {/* 日時は、開かなくても最初から見せる（行にまとめない） */}
        <div className="adjust-when" role="group" aria-labelledby="adjust-when-title">
          <Heading level={3} id="adjust-when-title" className="more-name adjust-when-title">
            {staying ? T.dayWhen(p.dayNo ?? 1) : T.when}
          </Heading>
          <TimeRows idPrefix="adj" date={p.date} start={p.start} end={p.end} onDate={p.onDate} onStart={p.onStart} onEnd={p.onEnd} startName={p.data.start.name} endName={p.data.end?.name} oneWay={!!p.data.end} stayFrom={p.stayEnds?.from} stayTo={p.stayEnds?.to} />
          <LeewayField start={p.start} end={p.end} value={p.leeway} onChange={p.onLeeway} oneWay={!!p.data.end || !!p.stayEnds?.to} />
          {p.car && (
            <div className="car-field">
              <Switch label={T.car} value={p.car.on} onChange={(v) => p.car!.onChange(v)} labelPosition="start" labelSpacing="spread" />
            </div>
          )}
        </div>
        {p.days && (
          <Row name={DAY_TEXT.count} value={staying ? DAY_TEXT.nights(p.days.planned - 1) : T.dayTrip}>
            <div className="trip-days" role="group" aria-label={DAY_TEXT.count}>
              <DayCount value={p.days.planned} made={p.days.made} max={p.days.max} onChange={p.days.onPlanned} />
              {p.stay && <StayFields idPrefix="adj-stay" fields={p.stay.fields} nights={p.stay.nights} same={p.stay.same} onSame={p.stay.onSame} far={p.stay.far} near={p.stay.near} numbered />}
              {p.days.onAdd && <Button variant="primary" width="100%" className="day-add" label={DAY_TEXT.add(p.days.made + 1)} onClick={p.days.onAdd} />}
            </div>
          </Row>
        )}
        {hasConds && (
          <Row name={T.conds} value={condNames.length ? condNames.join(T.join) : T.none} open={prefs.moveLess || prefs.calm}>
            <div className="toggles">
              {prefs.moveLess && <ToggleButton label={T.moveLess} isPressed={p.moveLess} onPressedChange={() => p.onMoveLess(!p.moveLess)} />}
              {prefs.calm && <ToggleButton label={T.calm} isPressed={p.calm} onPressedChange={() => p.onCalm(!p.calm)} />}
              {allConds.map((c) => (
                <ToggleButton key={c.tag} label={c.label} isPressed={active.has(c.tag)} onPressedChange={() => toggleCond(c)} />
              ))}
            </div>
          </Row>
        )}
        {districts.length > 1 && (
          <Row name={T.districts} value={skipped ? T.skipN(skipped) : T.all}>
            <Text as="p" display="block" type="supporting" className="note">
              {T.districtsNote}
            </Text>
            <div className="toggles">
              {districts.map((d) => {
                const on = !p.skipDistricts.includes(d)
                return (
                  <ToggleButton
                    key={d}
                    label={districtLabel(d, p.data.places)}
                    isPressed={on}
                    onPressedChange={() => p.onSkipDistricts(on ? [...p.skipDistricts, d] : p.skipDistricts.filter((x) => x !== d))}
                  />
                )
              })}
            </div>
          </Row>
        )}
        <Row name={T.missions} value={T.odaiN(p.odaiCount)}>
          <SegmentedControl value={String(p.odaiCount)} onChange={(v) => p.onOdaiCount(Number(v))} label={T.odai} layout="fill">
            {[1, 2, 3].map((n) => (
              <SegmentedControlItem key={n} value={String(n)} label={T.odaiN(n)} />
            ))}
          </SegmentedControl>
        </Row>
      </section>

      {p.days?.onDelete && (
        <section className="sheet-sec day-delete">
          <Button variant="destructive" width="100%" label={DAY_TEXT.remove} onClick={p.days.onDelete} />
        </section>
      )}
    </Sheet>
  )
}
