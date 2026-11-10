import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Heading } from '@astryxdesign/core/Heading'
import { Item } from '@astryxdesign/core/Item'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Badge } from '@astryxdesign/core/Badge'
import { Text } from '@astryxdesign/core/Text'
import { Toast } from '@astryxdesign/core/Toast'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import type { AreaData, Spot } from '../types'
import type { Slot } from '../lib/planner'
import { exampleAsked, takeExample } from '../lib/homeIntent'
import { HomeButton } from './HomeButton'
import { loadSample } from '../lib/api'
import { dateLabel, isHoliday } from '../lib/time'
import { distM } from '../lib/geo'
import { useTripWhy, WHY_CHIPS } from '../lib/why'
import { PLACE_WORDS as W } from './placeWords'
import { quietHint } from '../lib/crowd'
import type { MapProps } from './mapShared'
import { CandidateSheet } from './CandidateSheet'
import { OsmCredit } from './OsmCredit'
import { Thumb } from './Thumb'
import { tr } from '../lib/i18n'

// 選んだ場所と、プランのどの枠に入れるか（見どころは sight、食事は昼食か夕食、カフェは休憩）
export type Picked = { id: string; slot: Slot }

type Tab = 'sight' | 'food' | 'cafe'
const T = tr({
  ja: {
    tabs: [
      { key: 'sight', label: '見どころ' },
      { key: 'food', label: '食事' },
      { key: 'cafe', label: 'カフェ' },
    ] as { key: Tab; label: string }[],
    slot: { sight: '', lunch: '昼食', dinner: '夕食', cafe: '休憩' } as Record<Slot, string>,
    one: { sight: '', food: '昼食と夕食を1か所ずつ選べます。それより多く選ぶと入れ替わります。', cafe: 'カフェは1か所です。選ぶと入れ替わります。' } as Record<Tab, string>,
    loading: '候補を読み込んでいます……',
    famous: '人気スポット',
    hidden: '隠れた名所',
    wish: '希望に合う場所',
    changed: (slot: string, name: string) => `${slot}を${name}に変更しました`,
    sep: '・',
    otherArea: '場所と日付を変更',
    own: '自分の旅を作る',
    exTitle: (a: string) => `今は${a}の例です。`,
    example: '（例）',
    intro: '行く時間をずらして、混雑を避ける1日のプランを組みます。',
    lead: '行きたい場所を選んでください',
    none: '候補が見つかりませんでした',
    byGemini: '候補は Gemini が集めました。',
    more: (n: number) => `あと${n}か所を表示`,
    kind: '種類',
    count: (n: number) => `${n}か所`,
    make: 'この場所でプランを作る',
    addMore: '空いた時間にほかの場所も足す',
    auto: 'おまかせで作る',
    fit: (w: string) => `希望の「${w}」に合う`,
    add: '追加',
    on: '選択中',
    named: '希望に書いた場所',
    ask: '選んだ理由（任意）',
    askOf: (n: string) => `${n}を選んだ理由（任意）`,
    skip: 'スキップ',
  },
  en: {
    tabs: [
      { key: 'sight', label: 'Sights' },
      { key: 'food', label: 'Food' },
      { key: 'cafe', label: 'Cafés' },
    ],
    slot: { sight: '', lunch: 'Lunch', dinner: 'Dinner', cafe: 'Break' },
    one: { sight: '', food: 'Choose one place each for lunch and dinner. Choosing more replaces one.', cafe: 'One café per plan. Choosing another replaces it.' },
    loading: 'Loading places…',
    famous: 'Popular Spots',
    hidden: 'Hidden Gems',
    wish: 'Matching Your Wish',
    changed: (slot: string, name: string) => `Changed ${slot.toLowerCase()} to ${name}`,
    sep: ' · ',
    otherArea: 'Change Place & Date',
    own: 'Plan Your Trip',
    exTitle: (a: string) => `This is an example for ${a}.`,
    example: ' (Example)',
    intro: 'Plan a day that avoids crowded times and places.',
    lead: 'Choose places to visit',
    none: 'No places found',
    byGemini: ' Gemini found these places.',
    more: (n: number) => `Show ${n} More`,
    kind: 'Type',
    count: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
    make: 'Plan with These Places',
    addMore: 'Also add other places to free time',
    auto: 'Plan It for Me',
    fit: (w: string) => `Matches “${w}”`,
    add: 'Add',
    on: 'Added',
    named: 'Named in your wish',
    ask: 'Your Reason (Optional)',
    askOf: (n: string) => `Your reason for ${n} (optional)`,
    skip: 'Skip',
  },
})
const TABS = T.tabs
const SLOT_LABEL = T.slot
// 塊ごとに最初に見せる候補の数（残りは「あと N か所を表示」で出す。選んだ候補はいつも出す）
const FIRST = 4
const kindOf = (s: Spot): Tab => (s.kind === 'food' ? 'food' : s.kind === 'cafe' ? 'cafe' : 'sight')

// 食事は、昼だけ開く店は昼食、夜だけ開く店は夕食。両方開く店は昼食に入れ、昼食を選んであって夕食が空いていれば夕食にする
// （プランの画面の「ほかの候補に変更」の mealSlot と同じ考え方）
function slotOf(s: Spot, picks: Picked[]): Slot {
  if (s.kind === 'cafe') return 'cafe'
  if (s.kind !== 'food') return 'sight'
  const lunch = s.open <= 13 * 60 + 30 && s.close >= 11 * 60 + 45
  const dinner = s.open <= 19 * 60 + 30 && s.close >= 18 * 60 + 15
  if (dinner && !lunch) return 'dinner'
  if (lunch && dinner && picks.some((p) => p.slot === 'lunch') && !picks.some((p) => p.slot === 'dinner')) return 'dinner'
  return 'lunch'
}

// 希望に名前を書いた場所のうち、まだ選んでいない物を選んだ形にして足す（食事・休憩の枠に選んである店は入れ替えない）
function withNamed(spots: Spot[], picks: Picked[], skip: Set<string>): Picked[] {
  let out = picks
  for (const s of spots) {
    if (!s.named || s.source !== 'wish' || skip.has(s.id) || out.some((p) => p.id === s.id)) continue
    const slot = slotOf(s, out)
    if (slot !== 'sight' && out.some((p) => p.slot === slot)) continue
    out = [...out, { id: s.id, slot }]
  }
  return out
}

type Props = {
  map: ComponentType<MapProps>
  // 候補を出すエリア（入力の画面で集めた候補。届くたびに増える）。null なら例のエリアを読み込む
  area: AreaData | null
  date: string // YYYY-MM-DD
  // 候補を集めている途中の知らせ（無いときは空）
  note: string
  // 選んだ場所でプランを組む（何も選ばずに「おまかせで作る」ときは、どちらも空）。since: この画面を開いた時刻（これより後に入れた理由が、この旅の理由）
  onDone: (data: AreaData, must: string[], pinned: Picked[], since: number, opts: { fill: boolean; start?: number; end?: number; example?: boolean }) => void
  // 自分の旅（ホーム画面）へ戻る。見出しにいつも出す
  onHome: () => void
  // ほかのエリアで作る（入力の画面を開く）
  onOtherArea: () => void
  // 例のエリアを読み込めなかった
  onFail: () => void
}

// 最初の画面。エリアの地図と候補だけを出し、行きたい場所を選んでからプランを組む
export function StartPick({ map, area, date, note, onDone, onHome, onOtherArea, onFail }: Props) {
  const [sample, setSample] = useState<AreaData | null>(null)
  const data = area ?? sample
  useEffect(() => {
    if (area) return
    let alive = true
    loadSample().then((d) => {
      if (!alive) return
      if (d) setSample(d)
      else onFail()
    })
    return () => {
      alive = false
    }
    // 最初の 1 回だけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!data) return <Loading />
  return <Picking data={data} example={!area} map={map} date={date} note={note} onDone={onDone} onHome={onHome} onOtherArea={onOtherArea} />
}

function Loading() {
  return (
    <div className="plan-view start-pick">
      <main className="panel" aria-busy="true">
        <Text as="p" display="block" type="supporting" className="note pulse">
          {T.loading}
        </Text>
      </main>
    </div>
  )
}

// example: 例のエリア（京都）を出している。見出しに「例」を添え、右上は自分の旅を作る入口にする
function Picking({ data, example, map: MapPart, date, note: progress, onDone, onHome, onOtherArea }: Omit<Props, 'onFail' | 'area'> & { data: AreaData; example: boolean }) {
  const day = isHoliday(date) ? 'holiday' : 'weekday'
  const [tab, setTab] = useState<Tab>('sight')
  // 希望に名前を書いた場所は、最初から選んでおく（届くたびに足す。一度選んだ物は、外したあと選び直さない）
  const offered = useRef(new Set<string>())
  const [picks, setPicks] = useState<Picked[]>(() => (example ? [] : withNamed(data.places, [], offered.current)))
  const [addMore, setAddMore] = useState(false)
  useEffect(() => {
    for (const p of picks) offered.current.add(p.id)
  }, [picks])
  useEffect(() => {
    if (example) return
    setPicks((cur) => withNamed(data.places, cur, offered.current))
  }, [data, example])
  const [candId, setCandId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  // 全部を出した塊（札と見出しの組み）と、出したあとに読み上げとキーボードの位置を移す候補
  const [opened, setOpened] = useState<string[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusId) return
    document.getElementById(`pick-${focusId}`)?.focus()
    setFocusId(null)
  }, [focusId])
  // この画面を開いてから入れた理由だけを、一覧に出す（前に同じエリアで入れた理由は出さない）
  const [since] = useState(() => Date.now())
  const { get, put } = useTripWhy(data.area.name)
  // チェックで選んだ直後に、その行の下で理由を聞く候補（行を押して詳細から選んだときは、詳細の欄で聞く）
  const [ask, setAsk] = useState<string | null>(null)
  useEffect(() => {
    if (candId) setAsk(null)
  }, [candId])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(t)
  }, [toast])

  const byId = useMemo(() => new Map(data.places.map((p) => [p.id, p])), [data])
  // 希望から来た場所は「希望に合う場所」として先頭にまとめる（名前を書いた場所を先に）。
  // 見どころの残りは人気スポットと、隠れた名所の切り口ごとに分ける（切り口の無い隠れた名所は最後にまとめる）
  const noWish = !!data.query && !(data.query.wish ?? '').trim()
  const isWish = (p: Spot) => p.source === 'wish' && !noWish
  const groups = useMemo(() => {
    const all = (t: Tab) => data.places.filter((p) => kindOf(p) === t).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    const wished = (t: Tab) => all(t).filter(isWish).sort((a, b) => Number(!!b.named) - Number(!!a.named))
    // 希望から来た場所のほかは、人気が高く、出発地（到着地）から近い物を先に（1 km 離れるごとに人気を 0.5 下げ、3 まで）
    const ends = [data.start, ...(data.end ? [data.end] : [])]
    const score = (p: Spot) => (p.popularity ?? 0) - Math.min(6, Math.min(...ends.map((e) => distM(e, p))) / 1000) / 2
    const of = (t: Tab) => all(t).filter((p) => !isWish(p)).sort((a, b) => score(b) - score(a))
    const sights = of('sight')
    const hidden = sights.filter((s) => s.role !== 'famous')
    const themes = [...new Set(data.places.map((p) => (p.role !== 'famous' ? p.theme : undefined)))].filter(
      (t): t is string => !!t && t !== T.famous && t !== T.hidden && t !== T.wish,
    )
    return {
      sight: [
        [T.wish, wished('sight')],
        [T.famous, sights.filter((s) => s.role === 'famous')],
        ...themes.map((t) => [t, hidden.filter((s) => s.theme === t)]),
        [T.hidden, hidden.filter((s) => !s.theme || !themes.includes(s.theme))],
      ],
      food: [
        [T.wish, wished('food')],
        ['', of('food')],
      ],
      cafe: [
        [T.wish, wished('cafe')],
        ['', of('cafe')],
      ],
    } as Record<Tab, [string, Spot[]][]>
  }, [data])

  const hintOf = (title: string) => data.themes?.find((t) => t.label === title)?.hint ?? ''
  const picked = new Map(picks.map((p) => [p.id, p]))
  const pickedIds = useMemo(() => picks.map((p) => p.id), [picks])
  const add = (id: string) => {
    const s = byId.get(id)
    if (!s || picked.has(id)) return
    const slot = slotOf(s, picks)
    // 食事・休憩は 1 か所ずつ。同じ枠に選んであった店と入れ替える
    const old = slot === 'sight' ? undefined : picks.find((p) => p.slot === slot)
    setPicks([...picks.filter((p) => p !== old), { id, slot }])
    if (old) setToast({ id: Date.now(), text: T.changed(SLOT_LABEL[slot], s.name) })
  }
  const drop = (id: string) => {
    setPicks(picks.filter((p) => p.id !== id))
    if (ask === id) setAsk(null)
  }
  // チェック（と「追加」の文字）で選ぶ。この画面でまだ理由を入れていなければ、その行の下で理由を聞く
  const check = (id: string) => {
    add(id)
    const w = get(id)
    setAsk(w && w.at >= since ? null : id)
  }
  const answer = (s: Spot, chip: string) => {
    setAsk(null)
    if (!put({ spotId: s.id, spotName: s.name, chips: [chip], text: '', downsideSeen: s.downside, at: Date.now() })) setToast({ id: Date.now(), text: W.noRoom })
  }
  const fitOf = (s: Spot) => {
    if (!isWish(s)) return ''
    if (s.named) return T.named
    const rank = (tag: string) => (tag === '有名' ? 2 : tag === '静か' ? 1 : 0)
    const c = data.conditions.filter((x) => s.tags.includes(x.tag)).sort((a, b) => rank(a.tag) - rank(b.tag))[0]
    return c ? T.fit(c.label) : ''
  }
  const reasonOf = (id: string) => {
    const w = get(id)
    return w && w.at >= since ? [...w.chips, w.text.trim()].filter(Boolean).join(T.sep) : ''
  }
  // プランの画面は、地図が見える一番上から
  // 選んだ場所があるときは、選んだ場所と食事だけで組む（「空いた時間にほかの場所も足す」を選んだときだけ足す）
  const done = (list: Picked[], more = list.length === 0 || addMore, at?: { start: number; end?: number; example: true }) => {
    window.scrollTo(0, 0)
    onDone(
      data,
      list.filter((p) => p.slot === 'sight').map((p) => p.id),
      list.filter((p) => p.slot !== 'sight'),
      since,
      { fill: more, ...at },
    )
  }
  // ホーム画面の「例のプランを見る」から来たときは、例のエリアを読んだらすぐ、例の場所を選んだ形で組む
  useEffect(() => {
    if (!takeExample()) return
    const ex = data.example
    const ids = (ex?.must ?? []).filter((id) => byId.has(id))
    if (ex && ids.length) done(ids.map((id) => ({ id, slot: 'sight' as Slot })), false, { start: ex.start, ...(ex.end !== undefined && { end: ex.end }), example: true })
    else done([])
    // 開いたときの 1 回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cand = candId ? (byId.get(candId) ?? null) : null
  const pickedNames = picks.map((p) => byId.get(p.id)?.name).filter((x): x is string => !!x)
  // 最初から選んであった場所（希望に名前を書いた場所）だけなら、まだ自分では選んでいないので「おまかせで作る」
  const chose = picks.some((p) => !byId.get(p.id)?.named)
  // 候補を集め終えて 1 件も無いときは、見出しと一覧の代わりに一言と「エリアを変更」を出す
  const none = data.places.length === 0 && !progress
  const shown = groups[tab].filter(([, items]) => items.length > 0)

  // 例のプランを組むと頼まれているときは、選ぶ画面を見せずにすぐプランへ
  if (exampleAsked()) return <Loading />
  return (
    <div className="plan-view start-pick">
      <header className="top">
        <HomeButton onClick={onHome} />
        <div className="top-title">
          <Heading level={1} maxLines={1} hasTruncateTooltip={false}>
            {data.area.name}
            {example && <span className="top-ex">{T.example}</span>}
          </Heading>
          <Text as="p" display="block" type="supporting">
            <span className="num">{dateLabel(date)}</span>
          </Text>
        </div>
        <div className="top-actions stack">
          {!example && <Button variant="ghost" label={T.otherArea} onClick={onOtherArea} />}
        </div>
      </header>

      <div className="map-pane">
        <MapPart
          data={data}
          plan={null}
          focusId={null}
          candidates={data.places}
          candId={candId}
          picked={pickedIds}
          onOpen={setCandId}
          onCandidate={setCandId}
          onNotice={(text) => setToast({ id: Date.now(), text })}
        />
      </div>

      <main className="panel">
        <Heading level={2} className="sp-lead">
          {none ? T.none : T.lead}
        </Heading>
        {!none && (
          <Text as="p" display="block" type="supporting" className="sp-intro">
            {T.intro}
            {T.byGemini}
          </Text>
        )}
        {example && !none && (
          <div className="sp-own">
            <Text as="p" display="block" type="supporting">
              {T.exTitle(data.area.name)}
            </Text>
            <Button variant="secondary" size="sm" label={T.own} onClick={onOtherArea} />
          </div>
        )}
        {none && (
          <div className="sp-none">
            <Button variant="secondary" label={T.otherArea} width="100%" onClick={onOtherArea} />
          </div>
        )}
        {progress && (
          <Text as="p" display="block" type="supporting" className="note pulse sp-progress">
            {progress}
          </Text>
        )}
        {!none && (
          <div className="sp-tabs">
            <SegmentedControl value={tab} onChange={(v) => setTab(v as Tab)} label={T.kind} layout="fill" size="lg">
              {TABS.map((t) => (
                <SegmentedControlItem key={t.key} value={t.key} label={t.label} />
              ))}
            </SegmentedControl>
          </div>
        )}
        {!none && T.one[tab] && (
          <Text as="p" display="block" type="supporting" className="note pick-note">
            {T.one[tab]}
          </Text>
        )}
        {!none && !progress && shown.length === 0 && (
          <Text as="p" display="block" type="supporting" className="note">
            {T.none}
          </Text>
        )}

        {shown.map(([title, items], i) => (
          <section key={`${tab}-${i}-${title}`} className="pick-group">
            {title && (
              <Heading level={3} className="sec-title sp-group-title">
                {title}
                <span className="sp-group-n num">{T.count(items.length)}</span>
              </Heading>
            )}
            {title && hintOf(title) && (
              <Text as="p" display="block" type="supporting" className="sp-group-hint">
                {hintOf(title)}
              </Text>
            )}
            <ul className="pick-list">
              {(opened.includes(`${tab}|${title}`) ? items : items.filter((s, k) => k < FIRST || picked.has(s.id))).map((s) => {
                const p = picked.get(s.id)
                const why = p ? reasonOf(s.id) : ''
                const slot = p ? SLOT_LABEL[p.slot] : ''
                const quiet = quietHint(s, day)
                const fit = why ? '' : fitOf(s)
                const asking = !!p && ask === s.id && !cand
                return (
                  <li key={s.id} className="sp-item" data-on={p ? '' : undefined} data-ask={asking ? '' : undefined}>
                    <button type="button" className="pick-row" id={`pick-${s.id}`} onClick={() => setCandId(s.id)}>
                      <Item
                        as="span"
                        className="pick-item"
                        startContent={<Thumb spot={s} />}
                        label={
                          <span className="pick-name">
                            {s.name}
                            {slot && <Badge variant="neutral" label={slot} />}
                          </span>
                        }
                        description={
                          <span className="pick-sub">
                            {((!why && s.district) || quiet) && (
                              <span className="sp-meta">
                                {!why && s.district && <span className="sp-district">{s.district}</span>}
                                {!why && s.district && quiet && <span className="sp-sep">{T.sep}</span>}
                                {quiet && <span className="sp-quiet">{quiet}</span>}
                              </span>
                            )}
                            {fit && <span className="sp-fit">{fit}</span>}
                            {why ? <span className="sp-why">{why}</span> : <span className="sp-feat" data-short={fit ? '' : undefined}>{s.why}</span>}
                          </span>
                        }
                      />
                    </button>
                    <span className="sp-check">
                      <CheckboxInput label={s.name} isLabelHidden value={!!p} onChange={(on) => (on ? check(s.id) : drop(s.id))} />
                      <span className="sp-check-word" aria-hidden="true" onClick={() => (p ? drop(s.id) : check(s.id))}>
                        {p ? T.on : T.add}
                      </span>
                    </span>
                    {asking && (
                      <div className="sp-ask" role="group" aria-label={T.askOf(s.name)}>
                        <div className="sp-ask-head">
                          <span className="sp-ask-title" aria-hidden="true">
                            {T.ask}
                          </span>
                          <Button variant="ghost" className="sp-ask-skip" label={T.skip} onClick={() => setAsk(null)} />
                        </div>
                        <div className="sp-ask-chips">
                          {WHY_CHIPS.map((c) => (
                            <ToggleButton key={c} className="why-chip" label={c} isPressed={false} onPressedChange={() => answer(s, c)} />
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {(() => {
              const g = `${tab}|${title}`
              const hidden = opened.includes(g) ? [] : items.filter((s, k) => k >= FIRST && !picked.has(s.id))
              if (!hidden.length) return null
              return (
                <Button
                  variant="secondary"
                  width="100%"
                  className="sp-more"
                  label={T.more(hidden.length)}
                  onClick={() => {
                    setOpened([...opened, g])
                    setFocusId(hidden[0].id)
                  }}
                />
              )
            })()}
          </section>
        ))}

        <OsmCredit className="note foot" />

        <div className="sp-bar" hidden={none}>
          {picks.length > 0 ? (
            <>
              <p className="sp-sum">
                <span className="num">{T.count(picks.length)}</span>
                <span className="sp-names">{pickedNames.join(T.sep)}</span>
              </p>
              {chose && <CheckboxInput className="sp-fill" label={T.addMore} value={addMore} onChange={(v: boolean) => setAddMore(v)} />}
              <Button variant="primary" size="lg" className="sp-make" label={chose ? T.make : T.auto} width="100%" onClick={() => done(picks, !chose || addMore)} />
            </>
          ) : (
            <div className="sp-skip">
              <Button variant="primary" size="lg" label={T.auto} width="100%" onClick={() => done([])} />
            </div>
          )}
        </div>
      </main>

      {cand && (
        <CandidateSheet
          key={cand.id}
          data={data}
          spot={cand}
          day={day}
          planDate={date}
          picked={
            picked.has(cand.id)
              ? {
                  whySince: since,
                  onRemove: (id) => {
                    setCandId(null)
                    drop(id)
                  },
                }
              : undefined
          }
          onAdd={(id) => {
            setCandId(null)
            add(id)
          }}
          onClose={() => setCandId(null)}
          onNotice={(text) => setToast({ id: Date.now(), text })}
        />
      )}
      {toast && (
        <div className="toast-slot" key={toast.id}>
          <Toast type="info" body={toast.text} isAutoHide={false} autoHideDuration={3500} onDismiss={() => setToast(null)} />
        </div>
      )}
    </div>
  )
}
