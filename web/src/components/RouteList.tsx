import { useWalkDots } from '../lib/walkRail'
import { Fragment, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import type { AreaData, BusTrip } from '../types'
import type { Plan, TimeNote } from '../lib/planner'
import { roleText } from '../lib/found'
import { fmt, fmtDur } from '../lib/time'
import { afterSunset, needsReserve } from '../lib/caution'
import { sunsetMin } from '../lib/sun'
import { goalOf, type Leg } from '../lib/geo'
import { busName, isTrain } from '../lib/bus'
import { busColor, railColor, stepColor } from '../lib/lineColor'
import { LineChip } from './LineChip'
import { CrowdMark } from './CrowdMark'
import { ModeIcon } from './ModeIcon'
import { Thumb } from './Thumb'
import { tr } from '../lib/i18n'
import { slopeLook, type Slope } from '../lib/slope'

const T = tr({
  ja: {
    schedule: 'スケジュール',
    depart: '出発',
    arrive: '到着',
    leaveStay: '宿を出発',
    arriveStay: '宿に到着',
    finale: '旅の締めくくり',
    finaleWhy: (w: string) => `（${w}）`,
    finaleGap: '',
    whyEvening: '夕方が見ごろ',
    whySunset: '夕景',
    whyView: '眺めが良い',
    whyCalm: '静かに過ごせる',
    whyRest: 'ひと休み',
    closes: (t: string) => `${t}に営業終了（目安）`,
    reserve: '要予約',
    sunset: '日没後',
    reorder: (name: string) => `${name}の順番を変更`,
    drag: 'ドラッグして並べ替え',
    up: (name: string) => `${name}を1つ前へ移動`,
    down: (name: string) => `${name}を1つ後ろへ移動`,
    sep: '・',
    wait: (m: number) => `営業開始まで${m}分`,
    mins: (m: number, about: boolean) => `${about ? '約' : ''}${m}分`,
    then: ' → ',
    legOf: (a: string, b: string) => `${a}から${b}`,
    seeTrips: '便を見る',
    seeRail: '乗車駅を見る',
    seeRoute: '経路と時刻を見る',
    seeMode: '移動の手段を選択',
    missed: (t: string) => `${t}発に間に合いません`,
    unused: (t: string) => `${t}発の時刻は使用していません`,
  },
  en: {
    schedule: 'Schedule',
    depart: 'Depart',
    arrive: 'Arrive',
    leaveStay: 'Leave Lodging',
    arriveStay: 'Arrive at Lodging',
    finale: 'Trip Finale',
    finaleWhy: (w: string) => `(${w})`,
    finaleGap: ' ',
    whyEvening: 'best in the evening',
    whySunset: 'sunset views',
    whyView: 'great views',
    whyCalm: 'quiet and calm',
    whyRest: 'a break',
    closes: (t: string) => `Closes at ${t} (estimate)`,
    reserve: 'Reservation needed',
    sunset: 'After sunset',
    reorder: (name: string) => `Reorder ${name}`,
    drag: 'Drag to reorder',
    up: (name: string) => `Move ${name} up`,
    down: (name: string) => `Move ${name} down`,
    sep: ' · ',
    wait: (m: number) => `${m} min until opening`,
    mins: (m: number, about: boolean) => `${about ? '~' : ''}${m} min`,
    then: ' → ',
    legOf: (a: string, b: string) => `${a} to ${b}`,
    seeTrips: 'See Departures',
    seeRail: 'See Stations',
    seeRoute: 'See Route and Times',
    seeMode: 'Choose How to Get There',
    missed: (t: string) => `Can’t make the ${t} departure`,
    unused: (t: string) => `Not using the ${t} departure time`,
  },
})

const pad = (n: number) => String(n)

// 旅の締めくくりにした訳（組み立ての、一日の最後に向いた場所の選び方に合わせる）
const VIEW_TAGS = ['景色', '海', '水辺', '夜景']
export function finaleWhy(s: Plan['stops'][number], date: string): string {
  if (s.slot === 'cafe') return T.whyRest
  if (s.slot === 'sight' && s.spot.best === 'evening' && s.arrive >= 16 * 60 + 30) return T.whyEvening
  if (s.slot === 'sight' && s.spot.tags.some((t) => VIEW_TAGS.includes(t))) {
    const set = sunsetMin(date, s.spot.lat, s.spot.lng)
    return set !== null && s.arrive <= set && s.depart >= set - 45 ? T.whySunset : T.whyView
  }
  return T.whyCalm
}
// 旅の締めくくりの言葉（訳を添える）。場所の画面に出す
export const finaleText = (s: Plan['stops'][number], date: string) => `${T.finale}${T.finaleGap}${T.finaleWhy(finaleWhy(s, date))}`

// 区間の路線（便・電車の目安・入れた経路）と、路線図の線の色。路線が 1 つで色が分かる区間だけ色を返す
function legLines(leg: Leg, bus?: BusTrip) {
  const picked = leg.real?.bus
  const trip = picked ?? (leg.real ? undefined : bus)
  const rides = leg.real && !picked ? leg.real.steps.filter((x) => x.mode !== 'walk') : []
  const rail = !trip && !leg.real && leg.mode === 'transit' ? leg.rail : undefined
  const lines = trip
    ? [{ name: busName(trip), color: busColor(trip) }]
    : rail
      ? [{ name: rail.line, color: railColor(rail) }]
      : rides.map((x) => ({ name: x.line, color: stepColor(x, leg.real!) }))
  return { picked, trip, rides, rail, lines }
}
export function legRailColor(leg: Leg, bus?: BusTrip): string | undefined {
  if (leg.mode !== 'transit') return undefined
  const colors = [...new Set(legLines(leg, bus).lines.map((x) => x.color))]
  return colors.length === 1 && colors[0] ? colors[0] : undefined
}
type RailVars = CSSProperties & { '--rail-in'?: string; '--rail-out'?: string; '--rail'?: string }
const railVars = (inC?: string, outC?: string): RailVars | undefined =>
  inC || outC ? { ...(inC && { '--rail-in': inC }), ...(outC && { '--rail-out': outC }) } : undefined

// スケジュールを「自分だけの路線図」として描く。駅ナンバリングのような札でつなぎ、
// 公共交通機関の区間は太い実線、徒歩の区間は点線（マップの線と同じ形）。
export function RouteList({
  data,
  plan,
  date,
  changed,
  buses,
  slopes,
  onOpen,
  onTransit,
  onBus,
  onWalk,
  onMove,
  onMoveTo,
  editing = false,
  stay,
}: {
  data: AreaData
  plan: Plan
  date: string // プランの日付（日の入りを求める）
  // 手を入れたあとに、新しく入った・動いた場所（数秒だけ印を付ける）
  changed?: Set<string>
  buses?: (BusTrip | undefined)[] // 区間ごとの、時刻表から探したいちばん早く着くバスの便
  slopes?: (Slope | null)[] // 区間ごとの上り下り（徒歩の区間の行に出す）
  onOpen: (id: string) => void
  onTransit: (index: number) => void
  onBus?: (index: number) => void
  onWalk?: (index: number) => void // 歩く区間を押したとき（移動の手段を選択）
  onMove?: (id: string, delta: number) => void
  onMoveTo?: (id: string, to: number) => void
  // 出発地・到着地が泊まる宿か
  stay?: { from: boolean; to: boolean }
  // 並べ替えのあいだ（「並べ替え」を押したあと）。区間と場所の補足を隠し、順番の上下のボタンとつまみだけを出す
  editing?: boolean
}) {
  const legs = [...plan.stops.map((s) => s.leg), plan.back]
  const rails = legs.map((l, i) => legRailColor(l, buses?.[i]))
  // 行の右のつまみをなぞって並べ替える。なぞっている間は行を浮かせ、ほかの行をよけさせる。
  // 指が画面の上か下の端に近いときは、一覧を流す（広い画面では左の欄、狭い画面ではページ）
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const list = useRef<HTMLOListElement>(null)
  useWalkDots(list, [plan, editing])
  const grab = useRef<{ pid: number; id: string; from: number; y0: number; mids: number[]; h: number; box: HTMLElement | null; y: number; raf: number } | null>(null)
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; h: number } | null>(null)
  const scrollOf = (box: HTMLElement | null) => (box ? box.scrollTop : window.scrollY)
  const update = () => {
    const g = grab.current
    if (!g) return
    const dy = g.y + scrollOf(g.box) - g.y0
    const at = g.mids[g.from] + dy
    let to = 0
    g.mids.forEach((m, k) => {
      if (Math.abs(m - at) < Math.abs(g.mids[to] - at)) to = k
    })
    setDrag({ id: g.id, from: g.from, to, dy, h: g.h })
  }
  const edge = () => {
    const g = grab.current
    if (!g) return
    const top = g.box ? g.box.getBoundingClientRect().top : 0
    const bottom = g.box ? g.box.getBoundingClientRect().bottom : window.innerHeight
    const v = g.y < top + 90 ? -10 : g.y > bottom - 90 ? 10 : 0
    if (v) {
      if (g.box) g.box.scrollTop += v
      else window.scrollBy(0, v)
      update()
    }
    g.raf = requestAnimationFrame(edge)
  }
  const down = (e: PointerEvent<HTMLButtonElement>, id: string, i: number) => {
    const panel = e.currentTarget.closest('.panel') as HTMLElement | null
    const box = panel && panel.scrollHeight > panel.clientHeight && getComputedStyle(panel).overflowY !== 'visible' ? panel : null
    const boxes = rows.current.slice(0, plan.stops.length).map((r) => r?.getBoundingClientRect())
    if (boxes.some((x) => !x)) return
    const sc = scrollOf(box)
    e.currentTarget.setPointerCapture(e.pointerId)
    grab.current = { pid: e.pointerId, id, from: i, y0: e.clientY + sc, mids: boxes.map((x) => x!.top + x!.height / 2 + sc), h: boxes[i]!.height, box, y: e.clientY, raf: 0 }
    grab.current.raf = requestAnimationFrame(edge)
    setDrag({ id, from: i, to: i, dy: 0, h: boxes[i]!.height })
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const g = grab.current
    if (!g || g.pid !== e.pointerId) return
    g.y = e.clientY
    update()
  }
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const g = grab.current
    if (!g || g.pid !== e.pointerId) return
    cancelAnimationFrame(g.raf)
    grab.current = null
    const d = drag
    setDrag(null)
    if (d && d.to !== d.from) onMoveTo?.(d.id, d.to)
  }
  const key = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    onMove?.(id, e.key === 'ArrowUp' ? -1 : 1)
  }
  const shift = (i: number) => {
    if (!drag) return undefined
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, zIndex: 2, transition: 'none' }
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return { transform: `translateY(${-drag.h}px)` }
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return { transform: `translateY(${drag.h}px)` }
    return undefined
  }
  return (
    <ol ref={list} className="route" aria-label={T.schedule} data-editing={editing ? '' : undefined}>
      <li className="rt-node rt-end" data-out={legs[0].mode} style={railVars(undefined, rails[0])}>
        <time className="rt-time num">{fmt(plan.leave)}</time>
        <span className="rt-rail">
          <span className="rt-terminal" />
        </span>
        <span className="rt-body">
          <span className="rt-name">{data.start.name}</span>
          <span className="rt-meta">{stay?.from ? T.leaveStay : T.depart}</span>
        </span>
      </li>
      {plan.stops.map((s, i) => (
        <li key={s.spot.id} className="rt-group" ref={(el) => void (rows.current[i] = el)} style={shift(i)} data-lifted={drag?.from === i ? '' : undefined}>
          {editing ? (
            <LegGap mode={s.leg.mode} color={rails[i]} />
          ) : (
            <LegRow leg={s.leg} index={i} wait={s.wait} note={s.timeNote} bus={buses?.[i]} slope={slopes?.[i]} name={T.legOf(i === 0 ? data.start.name : plan.stops[i - 1].spot.name, s.spot.name)} onTransit={onTransit} onBus={onBus} onWalk={onWalk} />
          )}
          <div className="rt-stop-row" data-stop-id={s.spot.id}>
            {editing ? (
              <div className="rt-node rt-stop" data-in={s.leg.mode} data-out={legs[i + 1].mode} data-changed={changed?.has(s.spot.id) ? '' : undefined} style={railVars(rails[i], rails[i + 1])}>
                <time className="rt-time num">{fmt(s.arrive)}</time>
                <span className="rt-rail">
                  <span className="badge num" aria-hidden="true">
                    {pad(i + 1)}
                  </span>
                </span>
                <span className="rt-body">
                  <span className="rt-name rt-name-short">{s.spot.name}</span>
                </span>
              </div>
            ) : (
              <button
                type="button"
                className="rt-node rt-stop"
                data-in={s.leg.mode}
                data-out={legs[i + 1].mode}
                data-changed={changed?.has(s.spot.id) ? '' : undefined}
                style={railVars(rails[i], rails[i + 1])}
                onClick={() => onOpen(s.spot.id)}
              >
                <time className="rt-time num">{fmt(s.arrive)}</time>
                <span className="rt-rail">
                  <span className="badge num" aria-hidden="true">
                    {pad(i + 1)}
                  </span>
                </span>
                <span className="rt-body">
                  <span className="rt-name">{s.spot.name}</span>
                  <span className="rt-meta">
                    <span className="rt-stay nw">
                      {roleText(s)}
                      {T.sep}
                      <span className="num">{fmtDur(s.stay)}</span>
                    </span>
                    {s.estimated && (
                      <span className="rt-crowd">
                        <CrowdMark level={s.level} word />
                      </span>
                    )}
                  </span>
                  <Cautions items={[s.closeOver && T.closes(fmt(s.spot.close)), needsReserve(s.spot) && T.reserve, afterSunset(s.spot, s.arrive, date) && T.sunset]} />
                </span>
                <Thumb spot={s.spot} photoOnly ask={!data.example} />
              </button>
            )}
            {editing && onMove && (
              <span className="rt-steps">
                <IconButton className="rt-step" label={T.up(s.spot.name)} icon={<Icon icon="arrowUp" />} isDisabled={i === 0} onClick={() => onMove(s.spot.id, -1)} />
                <IconButton className="rt-step" label={T.down(s.spot.name)} icon={<Icon icon="arrowDown" />} isDisabled={i === plan.stops.length - 1} onClick={() => onMove(s.spot.id, 1)} />
              </span>
            )}
            {editing && onMoveTo && plan.stops.length > 1 && (
              <button
                type="button"
                className="rt-grip"
                aria-label={T.reorder(s.spot.name)}
                title={T.drag}
                onPointerDown={(e) => down(e, s.spot.id, i)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={(e) => key(e, s.spot.id)}
              >
                {/* 形の出所: AI が生成（Claude）。3 本の横線（Lucide の menu・Tabler の menu-2 と同じ種類の形だが、長さと間隔が違い、一致しない） */}
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M5 8h14M5 12h14M5 16h14" />
                </svg>
              </button>
            )}
          </div>
        </li>
      ))}
      <li className="rt-group">
        {editing ? (
          <LegGap mode={plan.back.mode} color={rails[plan.stops.length]} />
        ) : (
          <LegRow leg={plan.back} index={plan.stops.length} wait={0} note={plan.backTimeNote} bus={buses?.[plan.stops.length]} slope={slopes?.[plan.stops.length]} name={T.legOf(plan.stops.length ? plan.stops[plan.stops.length - 1].spot.name : data.start.name, goalOf(data).name)} onTransit={onTransit} onBus={onBus} onWalk={onWalk} />
        )}
        <div className="rt-node rt-end" data-in={plan.back.mode} style={railVars(rails[plan.stops.length])}>
          <time className="rt-time num">{fmt(plan.finish)}</time>
          <span className="rt-rail">
            <span className="rt-terminal" />
          </span>
          <span className="rt-body">
            <span className="rt-name">{goalOf(data).name}</span>
            <span className="rt-meta">{stay?.to ? T.arriveStay : T.arrive}</span>
          </span>
        </div>
      </li>
    </ol>
  )
}

// 並べ替えのあいだの区間。線だけを短く出す
function LegGap({ mode, color }: { mode: Leg['mode']; color?: string }) {
  return (
    <div className="rt-leg rt-leg-gap" data-mode={mode} aria-hidden="true" style={color ? ({ '--rail': color } as RailVars) : undefined}>
      <span className="rt-rail" />
    </div>
  )
}

// 閉まる時刻・予約・日の入りなど、行に赤い 1 行で出す注意
function Cautions({ items }: { items: (string | false)[] }) {
  const list = items.filter((x): x is string => !!x)
  if (!list.length) return null
  return (
    <span className="rt-warn num">
      {list.map((t, i) => (
        <span key={t} className="nw">
          {t}
          {i < list.length - 1 && T.sep}
        </span>
      ))}
    </span>
  )
}

// 区間の行（と地図の所要時間の札）を押したときに、便の画面を開くか（選んだ便・見つけた便・電車の目安がある区間）。無ければ経路の画面
export const legOpensBus = (leg: Leg, bus?: BusTrip) => !!(leg.real?.bus ?? (leg.real ? undefined : bus)) || (!leg.real && leg.mode === 'transit' && !!leg.rail)

// 区間の行。場所の札と札の間に、手段と分を出す。徒歩の区間は坂があれば小さな高さの線と一言も（距離・乗る時刻は押した先）。
// 行ぜんたいが 1 つのボタンで、電車・バスの区間は便があれば便の画面、無ければ乗換を入れる画面、歩く区間は手段の画面を開く
function LegRow({
  leg,
  index,
  wait,
  note,
  bus,
  slope,
  name,
  onTransit,
  onBus,
  onWalk,
}: {
  leg: Leg
  index: number
  wait: number
  note: TimeNote
  bus?: BusTrip
  slope?: Slope | null
  name: string // 読み上げに使う区間の名前（「京都駅から錦市場」）
  onTransit: (index: number) => void
  onBus?: (index: number) => void
  onWalk?: (index: number) => void
}) {
  const { picked, trip, rides, rail, lines } = legLines(leg, bus)
  const kind = trip ? (isTrain(trip) ? 'train' : 'bus') : rail ? 'train' : rides.length && rides.every((x) => x.mode === rides[0].mode) && rides[0].mode !== 'other' ? rides[0].mode : 'both'
  const depart = picked ? picked.board.time : leg.real?.depart
  const toBus = legOpensBus(leg, bus) && !!onBus
  const color = legRailColor(leg, bus)
  const hill = leg.mode === 'walk' ? slopeLook(slope) : null
  const body = (
    <>
      <span className="rt-leg-head">
        <ModeIcon mode={leg.mode === 'walk' ? 'walk' : leg.mode === 'car' ? 'car' : kind === 'bus' ? 'bus' : 'train'} />
        {lines.length ? (
          <>
            {lines.map((x, k) => (
              <Fragment key={k}>
                {k > 0 && <span className="rt-leg-then">{T.then}</span>}
                <LineChip name={x.name} color={x.color} />
              </Fragment>
            ))}
            <span className="rt-leg-min num">{T.mins(leg.minutes, false)}</span>
          </>
        ) : (
          <span className="rt-leg-mode num">{leg.label}</span>
        )}
        {hill && (
          <span className="rt-slope" role="img" aria-label={hill.label} title={hill.detail}>
            <svg viewBox="0 0 36 12" width="36" height="12" aria-hidden="true">
              <path d={hill.path} />
            </svg>
            {hill.word}
          </span>
        )}
        {wait > 0 && <span className="rt-leg-extra num">{T.wait(wait)}</span>}
      </span>
      {note === 'missed' && depart && <span className="rt-warn num">{T.missed(depart)}</span>}
      {note === 'other' && depart && <span className="rt-warn num">{T.unused(depart)}</span>}
    </>
  )
  const see = leg.mode === 'transit' ? (rail ? T.seeRail : toBus ? T.seeTrips : T.seeRoute) : T.seeMode
  return (
    <div className="rt-leg" data-mode={leg.mode} data-real={leg.real ? '' : undefined} style={color ? ({ '--rail': color } as RailVars) : undefined}>
      <span className="rt-rail" />
      {leg.mode === 'transit' || onWalk ? (
        <button type="button" className="rt-leg-text rt-leg-btn" onClick={() => (leg.mode !== 'transit' ? onWalk!(index) : toBus ? onBus!(index) : onTransit(index))}>
          <span className="rt-leg-body">
            <span className="sr-only">{name} </span>
            {body}
            <span className="sr-only"> {see}</span>
          </span>
          {leg.mode === 'transit' && <Icon icon="chevronRight" color="inherit" size="xsm" />}
        </button>
      ) : (
        <span className="rt-leg-text">{body}</span>
      )}
    </div>
  )
}
