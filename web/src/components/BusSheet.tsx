import { Button } from '@astryxdesign/core/Button'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import type { BusPick, BusTrip, BusVia, RailOpt } from '../types'
import { mapsAppDirUrl, mapsDirUrl, type Leg, type LegMode } from '../lib/geo'
import { busName, isTrain, rideMinutes, sameTrip, type BusSource } from '../lib/bus'
import { BusCredit } from './BusCredit'
import { OsmCredit } from './OsmCredit'
import { LineChip } from './LineChip'
import { MapsLink } from './MapsLink'
import { Sheet } from './Sheet'
import { LegModeChoice } from './LegMode'
import { tr } from '../lib/i18n'
import { busColor, railColor } from '../lib/lineColor'

type Props = {
  fromName: string
  toName: string
  leg: Leg
  trips: BusTrip[] | null // null は探している途中
  chosen: BusPick | null
  current?: BusTrip // 選んだ便が無いとき、今スケジュールに出ている便（時刻表から探した、いちばん早く着く便）
  rail?: RailOpt // 便が無いときに出す、乗り換えなしの電車の目安
  sources: BusSource[]
  contact: string | null
  onChoose: (t: BusTrip) => void
  onRemove: () => void
  onTransit: () => void // 乗換のスクリーンショットを入れる画面へ
  onMode: (m: LegMode | null) => void // 区間の手段を選ぶ（null は自動に戻す）
  onClose: () => void
}

const ordinal = (n: number) => {
  const r = n % 100
  return `${n}${r >= 11 && r <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const T = tr({
  ja: {
    both: '電車・バスの便',
    bus: 'バスの便',
    finding: '便を探しています……',
    none: 'この時間に乗換なしで行ける便はありません。',
    parts: (a: number, b: number, c: number) => `徒歩 ${a}分・乗車 ${b}分・徒歩 ${c}分`,
    bound: (h: string) => (/行き?$/.test(h) ? h : `${h} 行き`),
    chosen: '選択中',
    current: '今の便',
    choose: 'この便にする',
    remove: '便を外す',
    maps: 'ほかの行き方を Google マップで見る',
    shot: '乗換のスクリーンショットを入れる',
    rail: '電車の目安',
    board: '乗る',
    alight: '降りる',
    ride: (m: number) => `乗車 約${m}分`,
    railParts: (a: number, w: number, c: number) => `徒歩 ${a}分・待ち 約${w}分・徒歩 ${c}分`,
    railNote: '時刻表が無いので、時間は目安です。',
    estimate: '電車・バスの時間は目安です。',
    railCredit: '路線と駅:',
    getOff: (n: number, train: boolean) => (n === 1 ? (train ? '次の駅で降りる' : '次の停留所で降りる') : `${n}${train ? '駅' : '停'}目で降りる`),
    via: (n: number, train: boolean) => `途中 ${n}${train ? '駅' : '停留所'}`,
    hideVia: (train: boolean): string => (train ? '途中の駅を隠す' : '途中の停留所を隠す'),
    more: (n: number, train: boolean) => `……ほか ${n}${train ? '駅' : '停留所'}`,
    platform: (p: string, train: boolean) => (/(番線|のりば|乗り場|番)$/.test(p) ? p : train && /^\d+$/.test(p) ? `${p}番線` : `${p}のりば`),
  },
  en: {
    both: 'Train and Bus Departures',
    bus: 'Bus Departures',
    finding: 'Finding departures…',
    none: 'No direct departures around this time.',
    parts: (a: number, b: number, c: number) => `Walk ${a} min · Ride ${b} min · Walk ${c} min`,
    bound: (h: string) => `To ${h.replace(/\s*行き?$/, '')}`,
    chosen: 'Selected',
    current: 'Current',
    choose: 'Choose',
    remove: 'Remove Departure',
    maps: 'Other Routes in Google Maps',
    shot: 'Add a Route from a Screenshot',
    rail: 'Estimated Train',
    board: 'Board',
    alight: 'Get Off',
    ride: (m: number) => `Ride ~${m} min`,
    railParts: (a: number, w: number, c: number) => `Walk ${a} min · Wait ~${w} min · Walk ${c} min`,
    railNote: 'No timetable, so times are estimates.',
    estimate: 'Train and bus times are estimates.',
    railCredit: 'Lines and stations:',
    getOff: (n: number, train: boolean) => (n === 1 ? `Get off at the next ${train ? 'station' : 'stop'}` : `Get off at the ${ordinal(n)} ${train ? 'station' : 'stop'}`),
    via: (n: number, train: boolean) => `${n} ${train ? (n === 1 ? 'station' : 'stations') : n === 1 ? 'stop' : 'stops'} in between`,
    hideVia: (train: boolean) => (train ? 'Hide stations in between' : 'Hide stops in between'),
    more: (n: number, train: boolean) => `…and ${n} more ${train ? (n === 1 ? 'station' : 'stations') : n === 1 ? 'stop' : 'stops'}`,
    platform: (p: string, train: boolean) => `${train ? 'Platform' : 'Stop'} ${p}`,
  },
})

type LineVar = CSSProperties & { '--lc': string }
const lineVar = (c: string): LineVar => ({ '--lc': c })

// 途中の停留所。押すと時刻つきの一覧を開き、もう一度押すと閉じる
function ViaList({ via, between, train }: { via: BusVia[]; between: number; train: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const more = Math.max(0, between - via.length)
  return (
    <>
      <button type="button" className="tl-via-toggle bt-via-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {/* 形の出典: Lucide（https://lucide.dev）の chevron-down。ISC ライセンス */}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
        {open ? T.hideVia(train) : T.via(between, train)}
      </button>
      {open && (
        <ol id={id} className="tl-via">
          {via.map((v, i) => (
            <li key={`${i}-${v.time}-${v.name}`}>
              <span className="num">{v.time}</span>
              <span>{v.name}</span>
            </li>
          ))}
          {more > 0 && <li className="tl-via-more">{T.more(more, train)}</li>}
        </ol>
      )}
    </>
  )
}

// 乗る所・降りる所の行（時刻・路線の色の丸・名前・番線）
function StopRow({ at, time, name, platform }: { at: 'board' | 'alight'; time: ReactNode; name: string; platform?: string }) {
  return (
    <>
      <span className="tl-time">{time}</span>
      <span className="tl-node" data-at={at} aria-hidden="true" />
      <span className="tl-name">{name}</span>
      <span className="tl-plat">{platform}</span>
    </>
  )
}

// 区間の乗換なしのバス・電車の便（3 つまで）。選ぶと、その便の時刻でスケジュールを組み直す。
// 今スケジュールに出ている便は、選んだ便なら「選択中」、選ぶ前なら「今の便」として、選ぶボタンの代わりに出す。
// 暗幕を置かずに開き、上の地図でその区間を見られるようにする
export function BusSheet({ fromName, toName, leg, trips, chosen, current, rail, sources, contact, onChoose, onRemove, onTransit, onMode, onClose }: Props) {
  const list = trips ?? []
  const shown = chosen && !list.some((t) => sameTrip(t, chosen)) ? [chosen, ...list] : list
  // 便が見つからないときは、電車の目安を出す（時刻は無いので、乗る駅と降りる駅と分だけ）
  const est = trips !== null && !shown.length ? rail : undefined
  return (
    <Sheet title={est ? T.rail : shown.some(isTrain) ? T.both : T.bus} lead={`${fromName} → ${toName}`} onClose={onClose} card>
      {trips === null && !chosen && <p className="note pulse">{T.finding}</p>}
      {trips !== null && !shown.length && !est && <p className="note">{T.none}</p>}
      {est && (
        <ul className="bus-trips">
          <li className="bus-trip" style={lineVar(railColor(est))}>
            <div className="tl">
              <StopRow at="board" time={<span className="tl-tag">{T.board}</span>} name={est.board.name} />
              <span className="tl-node" data-at="ride" aria-hidden="true" />
              <div className="tl-body">
                <p className="tl-route">
                  <LineChip name={est.line} color={railColor(est)} mode="train" />
                </p>
                {est.stops > 0 && <p className="tl-sub">{T.getOff(est.stops, true)}</p>}
                <p className="tl-sub num">{T.ride(est.ride)}</p>
              </div>
              <StopRow at="alight" time={<span className="tl-tag">{T.alight}</span>} name={est.alight.name} />
            </div>
            <p className="bus-sub">{T.railParts(est.walkTo, est.wait, est.walkFrom)}</p>
          </li>
        </ul>
      )}
      {est && <p className="note">{T.railNote}</p>}
      {shown.length > 0 && (
        <ul className="bus-trips">
          {shown.map((t) => {
            // 1 つの便は、乗る時刻と降りる時刻をいちばん大きく、時刻表のように停留所と並べて出す（路線の色の線と丸でつなぐ）。
            // 間に路線名の札と行き先・何停目で降りるか・途中の停留所、下の段に徒歩と乗車の分と選ぶボタン
            const on = chosen ? sameTrip(t, chosen) : !!current && sameTrip(t, current)
            const train = isTrain(t)
            const color = busColor(t)
            const via = t.via ?? []
            return (
              <li key={`${busName(t)}-${t.board.time}-${t.board.name}`} className="bus-trip" data-on={on ? '' : undefined} style={lineVar(color)}>
                <div className="tl">
                  <StopRow at="board" time={<span className="bt-time num">{t.board.time}</span>} name={t.board.name} platform={t.board.platform ? T.platform(t.board.platform, train) : undefined} />
                  <span className="tl-node" data-at="ride" aria-hidden="true" />
                  <div className="tl-body">
                    <p className="tl-route">
                      <LineChip name={busName(t)} color={color} text={t.textColor} mode={train ? 'train' : 'bus'} />
                      {t.headsign && <span className="tl-bound">{T.bound(t.headsign)}</span>}
                    </p>
                    {t.stops > 0 && <p className="tl-sub">{T.getOff(t.stops, train)}</p>}
                    {via.length > 0 && t.stops > 1 && <ViaList via={via} between={t.stops - 1} train={train} />}
                  </div>
                  <StopRow at="alight" time={<span className="bt-time num">{t.alight.time}</span>} name={t.alight.name} platform={t.alight.platform ? T.platform(t.alight.platform, train) : undefined} />
                </div>
                <div className="bt-foot">
                  <p className="bus-sub">{T.parts(t.walkTo, rideMinutes(t), t.walkFrom)}</p>
                  {on && chosen ? (
                    <span className="bus-chosen">{T.chosen}</span>
                  ) : (
                    <span className="bt-act">
                      {on && <span className="bus-chosen">{T.current}</span>}
                      <Button variant="secondary" className="bt-choose" label={`${busName(t)} ${t.board.time} ${T.choose}`} onClick={() => onChoose(t)}>
                        {T.choose}
                      </Button>
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {shown.length > 0 && <p className="note">{T.estimate}</p>}
      {chosen && (
        <div className="sheet-actions">
          <Button variant="secondary" width="100%" label={T.remove} onClick={onRemove} />
        </div>
      )}
      <LegModeChoice leg={leg} onMode={onMode} />
      <p className="bus-maps">
        <MapsLink className="leg-action" web={mapsDirUrl(leg)} app={mapsAppDirUrl(leg)}>
          {T.maps}
        </MapsLink>
        <Button variant="ghost" className="leg-action" label={T.shot} onClick={onTransit} />
      </p>
      <BusCredit sources={sources} contact={contact} />
      {est && <OsmCredit className="note" label={T.railCredit} />}
    </Sheet>
  )
}
