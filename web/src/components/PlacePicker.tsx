import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Heading } from '@astryxdesign/core/Heading'
import { Item } from '@astryxdesign/core/Item'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Text } from '@astryxdesign/core/Text'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AreaData, Spot } from '../types'
import type { Day } from '../lib/crowd'
import type { Plan } from '../lib/planner'
import { FOUND_ROLE, isFound, roleText } from '../lib/found'
import { fmt } from '../lib/time'
import { CandidateSheet } from './CandidateSheet'
import { GeminiMark } from './GeminiMark'
import { PhotoCredits } from './PhotoCredit'
import { Sheet } from './Sheet'
import { Thumb } from './Thumb'
import { tr } from '../lib/i18n'

type Tab = 'sight' | 'food' | 'cafe'
const T = tr({
  ja: {
    tabs: [
      { key: 'sight', label: '見どころ', note: '' },
      { key: 'food', label: '食事', note: '昼食と夕食は1か所ずつです。選ぶと入れ替わります。' },
      { key: 'cafe', label: 'カフェ', note: 'カフェは1か所です。選ぶと入れ替わります。' },
    ] as { key: Tab; label: string; note: string }[],
    other: 'その他',
    fresh: '新しい候補',
    title: '場所を足す・外す',
    lead: '混雑を避けた時間にプランへ追加します。',
    kind: '種類',
    skipped: '（回らない地区）',
    arrive: (role: string, t: string) => `${role}・${t}に到着`,
    famous: '人気スポット',
    hidden: '隠れた名所',
  },
  en: {
    tabs: [
      { key: 'sight', label: 'Sights', note: '' },
      { key: 'food', label: 'Food', note: 'One place each for lunch and dinner. Choosing another replaces it.' },
      { key: 'cafe', label: 'Cafés', note: 'One café per plan. Choosing another replaces it.' },
    ],
    other: 'Other',
    fresh: 'New Options',
    title: 'Add or Remove Places',
    lead: 'Checked places go into your plan at less crowded times.',
    kind: 'Type',
    skipped: ' (skipped)',
    arrive: (role: string, t: string) => `${role} · Arrive ${t}`,
    famous: 'Popular',
    hidden: 'Hidden gem',
  },
})
const TABS = T.tabs
const kindOf = (s: Spot): Tab => (s.kind === 'food' ? 'food' : s.kind === 'cafe' ? 'cafe' : 'sight')

type Props = {
  data: AreaData
  plan: Plan
  skipDistricts: string[]
  // 行を押して開く候補の画面に渡す（混雑の推定の曜日・プランの日・この旅の理由として出す理由の時刻）
  day: Day
  planDate: string
  whySince: number
  onToggle: (id: string, on: boolean) => void
  onNotice: (text: string) => void
  onClose: () => void
  // 候補の画面を開いた・閉じた（地図にその候補を大きく出す）
  onShow?: (id: string | null) => void
}

type Group = [string, Spot[]]

// 地区ごとに、開いたときにプランに入っている場所・人気の場所を先に。開いている間は並びを変えない（押した行が動かないように）
function orderOf(data: AreaData, inPlan: Set<string>): Record<Tab, Group[]> {
  const out = { sight: [], food: [], cafe: [] } as Record<Tab, Group[]>
  for (const tab of ['sight', 'food', 'cafe'] as Tab[]) {
    const groups = new Map<string, Spot[]>()
    for (const s of data.places.filter((p) => kindOf(p) === tab)) {
      const d = s.district || T.other
      if (!groups.has(d)) groups.set(d, [])
      groups.get(d)!.push(s)
    }
    const on = (s: Spot) => Number(inPlan.has(s.id))
    out[tab] = [...groups.entries()]
      .map(([d, items]) => [d, items.sort((a, b) => on(b) - on(a) || (b.popularity ?? 0) - (a.popularity ?? 0))] as Group)
      .sort((a, b) => b[1].filter((s) => inPlan.has(s.id)).length - a[1].filter((s) => inPlan.has(s.id)).length || b[1].length - a[1].length)
  }
  return out
}

// 行きたい場所を選ぶ。チェックの付いた場所がプランに入っている場所。
// 最初の画面と同じく、行を押すと候補の画面（「戻る」でこの一覧に戻る）、右の印を押すとその場で入れる・外す
export function PlacePicker({ data, plan, skipDistricts, day, planDate, whySince, onToggle, onNotice, onClose, onShow }: Props) {
  const [tab, setTab] = useState<Tab>('sight')
  const inPlan = new Map(plan.stops.map((s) => [s.spot.id, s]))
  const [order] = useState(() => orderOf(data, new Set(inPlan.keys())))
  // 押した直後から印を変える（組み直しが終わるまで待たせない）
  const [pending, setPending] = useState<Record<string, boolean>>({})
  useEffect(() => setPending({}), [plan])
  // 新しく届いた候補は、その種類の最後に足す
  const known = new Set(Object.values(order).flatMap((gs) => gs.flatMap(([, items]) => items.map((s) => s.id))))
  const extra = data.places.filter((s) => kindOf(s) === tab && !known.has(s.id))
  const groups: Group[] = [...order[tab].map(([d, items]) => [d, items.map((s) => data.places.find((p) => p.id === s.id) ?? s)] as Group), ...(extra.length ? [[T.fresh, extra] as Group] : [])]
  const note = TABS.find((t) => t.key === tab)!.note
  const toggle = (id: string, on: boolean) => {
    setPending((p) => ({ ...p, [id]: !on }))
    onToggle(id, on)
  }
  // 候補の画面を開いている場所。開く前の一覧の位置と押した行を覚え、戻ったらそこへ戻す
  const [openId, setOpenId] = useState<string | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const from = useRef<{ id: string; y: number } | null>(null)
  const show = (id: string) => {
    from.current = { id, y: top.current?.closest('.sheet-body')?.scrollTop ?? 0 }
    setOpenId(id)
  }
  useEffect(() => {
    onShow?.(openId)
    // onShow は呼んだ側で毎回作り直されるので、開いている候補が変わったときだけ知らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onShow?.(null), [])
  useLayoutEffect(() => {
    const body = top.current?.closest('.sheet-body')
    if (!openId && from.current && body) body.scrollTop = from.current.y
  }, [openId])
  useEffect(() => {
    if (openId || !from.current) return
    document.getElementById(`pp-${from.current.id}`)?.focus({ preventScroll: true })
    from.current = null
  }, [openId])

  const open = openId ? data.places.find((p) => p.id === openId) : undefined
  if (open) {
    const on = pending[open.id] ?? inPlan.has(open.id)
    return (
      <CandidateSheet
        key={open.id}
        data={data}
        spot={open}
        day={day}
        planDate={planDate}
        card={false}
        back
        picked={
          on
            ? {
                whySince,
                onRemove: (id) => {
                  toggle(id, true)
                  setOpenId(null)
                },
              }
            : undefined
        }
        onAdd={(id) => {
          toggle(id, false)
          setOpenId(null)
        }}
        onClose={() => setOpenId(null)}
        onNotice={onNotice}
      />
    )
  }

  return (
    <Sheet title={T.title} lead={T.lead} onClose={onClose}>
      <div ref={top}>
        <div className="sp-tabs">
          <SegmentedControl value={tab} onChange={(v) => setTab(v as typeof tab)} label={T.kind} layout="fill" size="lg">
            {TABS.map((t) => (
              <SegmentedControlItem key={t.key} value={t.key} label={t.label} />
            ))}
          </SegmentedControl>
        </div>
      </div>
      {note && (
        <Text as="p" display="block" type="supporting" className="note pick-note">
          {note}
        </Text>
      )}

      {groups.map(([district, items]) => (
        <section key={district} className="pick-group">
          <Heading level={3} className="sec-title">
            {district}
            {skipDistricts.includes(district) && <span className="muted">{T.skipped}</span>}
          </Heading>
          <ul className="pick-list">
            {items.map((s) => {
              const st = inPlan.get(s.id)
              const on = pending[s.id] ?? !!st
              return (
                <li key={s.id} className="sp-item" data-on={on ? '' : undefined}>
                  <button type="button" className="pick-row" id={`pp-${s.id}`} onClick={() => show(s.id)}>
                    <Item
                      as="span"
                      startContent={<Thumb spot={s} />}
                      label={<span className="pick-name">{s.name}</span>}
                      description={
                        <span className="pick-sub">
                          {st ? (
                            <span className="num">{T.arrive(roleText(st), fmt(st.arrive))}</span>
                          ) : (
                            <>
                              {tab === 'sight' && <span className="sp-district">{isFound(s) ? FOUND_ROLE : s.role === 'famous' ? T.famous : T.hidden}</span>}
                              {s.why && (
                                <span className="sp-feat">
                                  <GeminiMark />
                                  {s.why}
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      }
                    />
                  </button>
                  <span className="sp-check">
                    <CheckboxInput label={s.name} isLabelHidden value={on} onChange={() => toggle(s.id, on)} />
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <PhotoCredits spots={groups.flatMap(([, items]) => items)} />
    </Sheet>
  )
}
