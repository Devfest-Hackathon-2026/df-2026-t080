import { useWalkDots } from '../lib/walkRail'
import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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
import { LineMark } from './LineMark'
import { CrowdMark } from './CrowdMark'
import { ModeIcon } from './ModeIcon'
import { Thumb } from './Thumb'
import { isEn, tr } from '../lib/i18n'
import { slopeLook, type Slope } from '../lib/slope'
import { distText, useWalkMeters } from '../lib/walkDist'

const T = tr({
  ja: {
    schedule: 'スケジュール',
    depart: '出発',
    arrive: '到着',
    finale: '旅の締めくくり',
    finaleWhy: (w: string) => `（${w}）`,
    finaleGap: '',
    whyEvening: '夕方が見ごろ',
    whySunset: '夕景',
    whyView: '眺めが良い',
    whyCalm: '静かに過ごせる',
    whyRest: 'ひと休み',
    fits: '希望に合う',
    auto: 'おまかせで追加',
    closes: (t: string) => `${t}に閉まります（目安）`,
    reserve: '要予約',
    sunset: '日没後',
    reorder: (name: string) => `${name}の順番を変える`,
    drag: 'なぞって順番を変える',
    up: (name: string) => `${name}を1つ前にする`,
    down: (name: string) => `${name}を1つ後にする`,
    sep: '・',
    wait: (m: number) => `営業開始まで${m}分（目安）`,
    mins: (m: number, about: boolean) => `${about ? '約' : ''}${m}分`,
    then: ' → ',
    legOf: (a: string, b: string) => `${a}から${b}`,
    seeTrips: '便を見る',
    seeRail: '乗る駅を見る',
    seeRoute: '経路と時刻を見る',
    seeMode: '移動の手段を選ぶ',
    missed: (t: string) => `${t}発に間に合いません`,
    unused: (t: string) => `${t}発の時刻は使っていません`,
  },
  en: {
    schedule: 'Schedule',
    depart: 'Depart',
    arrive: 'Arrive',
    finale: 'Trip Finale',
    finaleWhy: (w: string) => `(${w})`,
    finaleGap: ' ',
    whyEvening: 'best in the evening',
    whySunset: 'sunset views',
    whyView: 'great views',
    whyCalm: 'quiet and calm',
    whyRest: 'a break',
    fits: 'Matches your wish',
    auto: 'Added for you',
    closes: (t: string) => `Closes at ${t} (estimate)`,
    reserve: 'Reservation needed',
    sunset: 'After sunset',
    reorder: (name: string) => `Reorder ${name}`,
    drag: 'Drag to reorder',
    up: (name: string) => `Move ${name} up`,
    down: (name: string) => `Move ${name} down`,
    sep: ' · ',
    wait: (m: number) => `${m} min until opening (estimate)`,
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
function finaleWhy(s: Plan['stops'][number], date: string): string {
  if (s.slot === 'cafe') return T.whyRest
  if (s.slot === 'sight' && s.spot.best === 'evening' && s.arrive >= 16 * 60 + 30) return T.whyEvening
  if (s.slot === 'sight' && s.spot.tags.some((t) => VIEW_TAGS.includes(t))) {
    const set = sunsetMin(date, s.spot.lat, s.spot.lng)
    return set !== null && s.arrive <= set && s.depart >= set - 45 ? T.whySunset : T.whyView
  }
  return T.whyCalm
}
// 区間の行の語の区切り。区切りは前の語の後ろに付け、英語は区切りのあとの空白でだけ折り返す
const SEP_END = isEn ? '\u00a0·' : '・'
const GAP = isEn ? ' ' : ''

// スケジュールを「自分だけの路線図」として描く。駅ナンバリングのような札でつなぎ、
// 公共交通機関の区間は太い実線、徒歩の区間は点線（マップの線と同じ形）。
export function RouteList({
  data,
  plan,
  date,
  changed,
  auto,
  buses,
  slopes,
  onOpen,
  onTransit,
  onBus,
  onWalk,
  onMove,
  onMoveTo,
  editing = false,
}: {
  data: AreaData
  plan: Plan
  date: string // プランの日付（日の入りを求める）
  // 手を入れたあとに、新しく入った・動いた場所（数秒だけ印を付ける）
  changed?: Set<string>
  // 自分で選んでいない（おまかせで足した）場所。「場所を足す・外す」で外せる
  auto?: Set<string>
  buses?: (BusTrip | undefined)[] // 区間ごとの、時刻表から探したいちばん早く着くバスの便
  slopes?: (Slope | null)[] // 区間ごとの、歩く所の上り下り
  onOpen: (id: string) => void
  onTransit: (index: number) => void
  onBus?: (index: number) => void
  onWalk?: (index: number) => void // 歩く区間を押したとき（移動の手段を選ぶ）
  onMove?: (id: string, delta: number) => void
  onMoveTo?: (id: string, to: number) => void
  // 並べ替えのあいだ（「並べ替え」を押したあと）。区間と場所の補足を隠し、順番の上下のボタンとつまみだけを出す
  editing?: boolean
}) {
  const legs = [...plan.stops.map((s) => s.leg), plan.back]
  const walkM = useWalkMeters(legs)
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
      <li className="rt-node rt-end" data-out={legs[0].mode}>
        <time className="rt-time num">{fmt(plan.leave)}</time>
        <span className="rt-rail">
          <span className="rt-terminal" />
        </span>
        <span className="rt-body">
          <span className="rt-name">{data.start.name}</span>
          <span className="rt-meta">{T.depart}</span>
        </span>
      </li>
      {plan.stops.map((s, i) => (
        <li key={s.spot.id} className="rt-group" ref={(el) => void (rows.current[i] = el)} style={shift(i)} data-lifted={drag?.from === i ? '' : undefined}>
          {editing ? (
            <LegGap mode={s.leg.mode} />
          ) : (
            <LegRow leg={s.leg} index={i} wait={s.wait} note={s.timeNote} bus={buses?.[i]} slope={slopes?.[i]} meters={walkM[i]} name={T.legOf(i === 0 ? data.start.name : plan.stops[i - 1].spot.name, s.spot.name)} onTransit={onTransit} onBus={onBus} onWalk={onWalk} />
          )}
          <div className="rt-stop-row" data-stop-id={s.spot.id}>
            {editing ? (
              <div className="rt-node rt-stop" data-in={s.leg.mode} data-out={legs[i + 1].mode} data-changed={changed?.has(s.spot.id) ? '' : undefined}>
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
                    <span className="rt-stay">
                      {[roleText(s), fmtDur(s.stay), s.fits.length > 0 && T.fits]
                        .filter((x): x is string => !!x)
                        .map((x, k, all) => (
                          <Fragment key={k}>
                            <span className={k === 1 ? 'nw num' : 'nw'}>
                              {x}
                              {(k < all.length - 1 || s.finale) && SEP_END}
                            </span>
                            {(k < all.length - 1 || s.finale) && GAP}
                          </Fragment>
                        ))}
                      {s.finale && (
                        <span className="rt-fin">
                          <span>{T.finale}</span>
                          {T.finaleGap}
                          <span>{T.finaleWhy(finaleWhy(s, date))}</span>
                        </span>
                      )}
                    </span>
                    {s.estimated && (
                      <span className="rt-crowd">
                        <CrowdMark level={s.level} word />
                      </span>
                    )}
                  </span>
                  {auto?.has(s.spot.id) && <span className="rt-note">{T.auto}</span>}
                  <Cautions items={[s.closeOver && T.closes(fmt(s.spot.close)), needsReserve(s.spot) && T.reserve, afterSunset(s.spot, s.arrive, date) && T.sunset]} />
                </span>
                <Thumb spot={s.spot} photoOnly />
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
          <LegGap mode={plan.back.mode} />
        ) : (
          <LegRow leg={plan.back} index={plan.stops.length} wait={0} note={plan.backTimeNote} bus={buses?.[plan.stops.length]} slope={slopes?.[plan.stops.length]} meters={walkM[plan.stops.length]} name={T.legOf(plan.stops.length ? plan.stops[plan.stops.length - 1].spot.name : data.start.name, goalOf(data).name)} onTransit={onTransit} onBus={onBus} onWalk={onWalk} />
        )}
        <div className="rt-node rt-end" data-in={plan.back.mode}>
          <time className="rt-time num">{fmt(plan.finish)}</time>
          <span className="rt-rail">
            <span className="rt-terminal" />
          </span>
          <span className="rt-body">
            <span className="rt-name">{goalOf(data).name}</span>
            <span className="rt-meta">{T.arrive}</span>
          </span>
        </div>
      </li>
    </ol>
  )
}

// 並べ替えのあいだの区間。線だけを短く出す
function LegGap({ mode }: { mode: Leg['mode'] }) {
  return (
    <div className="rt-leg rt-leg-gap" data-mode={mode} aria-hidden="true">
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

// 区間の行。場所の札と札の間に、手段と分を小さく出す（歩く区間は 1 行）。
// 電車・バスの区間は行ぜんたいが 1 つのボタンで、便があれば便の画面、無ければ乗換を入れる画面を開く。
// 乗る時刻・停留所は押した先（便の画面・経路の画面）に出す
function LegRow({
  leg,
  index,
  wait,
  note,
  bus,
  slope,
  meters,
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
  meters?: number | null // 徒歩の区間の、道に沿った線の長さ（線が無ければ null）
  name: string // 読み上げに使う区間の名前（「京都駅から錦市場」）
  onTransit: (index: number) => void
  onBus?: (index: number) => void
  onWalk?: (index: number) => void
}) {
  const picked = leg.real?.bus
  const trip = picked ?? (leg.real ? undefined : bus)
  const rides = leg.real && !picked ? leg.real.steps.filter((x) => x.mode !== 'walk') : []
  // 便も経路も無い区間の、電車の目安（時刻は無いので、乗る駅と降りる駅だけを出す）
  const rail = !trip && !leg.real && leg.mode === 'transit' ? leg.rail : undefined
  const hill = slopeLook(slope)
  const kind = trip ? (isTrain(trip) ? 'train' : 'bus') : rail ? 'train' : rides.length && rides.every((x) => x.mode === rides[0].mode) && rides[0].mode !== 'other' ? rides[0].mode : 'both'
  const about = !leg.real
  const extra = wait > 0 ? [T.wait(wait)] : []
  const depart = picked ? picked.board.time : leg.real?.depart
  const lines = trip
    ? [{ name: busName(trip), color: busColor(trip) }]
    : rail
      ? [{ name: rail.line, color: railColor(rail) }]
      : rides.map((x) => ({ name: x.line, color: stepColor(x, leg.real!) }))
  // 1 行目の語（路線・分・ゆとりなど）。語の中では折り返さない
  type Piece = { k: string; line?: { name: string; color: string | null }; text?: string }
  const pieces: Piece[] = [
    ...(lines.length ? [...lines.map((x, k) => ({ k: `l${k}`, line: x })), { k: 'min', text: T.mins(leg.minutes, about) }] : [{ k: 'mode', text: leg.label }]),
    ...(leg.mode === 'walk' && meters != null ? [{ k: 'dist', text: distText(meters) }] : []),
    ...extra.map((t) => ({ k: t, text: t })),
  ]
  const toBus = legOpensBus(leg, bus) && !!onBus
  const body = (
    <>
      <span className="rt-leg-head">
        {pieces.map((p, i) => (
          <span key={p.k}>
            {i > 0 && GAP}
            <span className={p.line ? 'rt-leg-line' : p.k === 'min' ? 'rt-leg-min num' : p.k === 'mode' ? 'rt-leg-mode num' : 'rt-leg-extra num'}>
              {i === 0 && <ModeIcon mode={leg.mode === 'walk' ? 'walk' : kind === 'bus' ? 'bus' : 'train'} />}
              {p.line ? (
                <>
                  {i > 0 && T.then}
                  <LineMark color={p.line.color} />
                  {p.line.name}
                </>
              ) : (
                p.text
              )}
              {i < pieces.length - 1 && !(p.line && pieces[i + 1].line) && <span className="rt-leg-sep">{SEP_END}</span>}
            </span>
          </span>
        ))}
        {hill && ' '}
        {hill && (
          <span className="rt-slope" role="img" aria-label={hill.label} title={hill.detail}>
            <svg viewBox="0 0 36 12" width="36" height="12" aria-hidden="true">
              <path d={hill.path} />
            </svg>
            {hill.word}
          </span>
        )}
      </span>
      {note === 'missed' && depart && <span className="rt-warn num">{T.missed(depart)}</span>}
      {note === 'other' && depart && <span className="rt-warn num">{T.unused(depart)}</span>}
      {leg.mode === 'transit' && (
        <span className="rt-leg-see">
          <span className="sr-only"> </span>
          {rail ? T.seeRail : toBus ? T.seeTrips : T.seeRoute}
          <Icon icon="chevronRight" color="inherit" size="xsm" />
        </span>
      )}
    </>
  )
  return (
    <div className="rt-leg" data-mode={leg.mode} data-real={leg.real ? '' : undefined}>
      <span className="rt-rail" />
      {leg.mode === 'transit' ? (
        <button type="button" className="rt-leg-text rt-leg-btn" onClick={() => (toBus ? onBus!(index) : onTransit(index))}>
          <span className="rt-leg-body">
            <span className="sr-only">{name} </span>
            {body}
          </span>
        </button>
      ) : onWalk ? (
        <button type="button" className="rt-leg-text rt-leg-btn" onClick={() => onWalk(index)}>
          <span className="rt-leg-body">
            <span className="sr-only">{name} </span>
            {body}
            <span className="sr-only"> {T.seeMode}</span>
          </span>
        </button>
      ) : (
        <span className="rt-leg-text">{body}</span>
      )}
    </div>
  )
}
