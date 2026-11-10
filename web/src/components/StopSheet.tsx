import { useEffect, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { Text } from '@astryxdesign/core/Text'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import type { AreaData } from '../types'
import { hourly } from '../lib/crowd'
import { mapsAppDirUrl, mapsAppPlaceUrl, mapsDirUrl, mapsPlaceUrl } from '../lib/geo'
import { CrowdMark } from './CrowdMark'
import { MapsLink } from './MapsLink'
import { alternatives, type Plan, type PlanInput, type Stop } from '../lib/planner'
import { fmt, fmtDur } from '../lib/time'
import { daysUntil } from '../lib/highlight'
import { usePlaceInfo } from '../lib/place'
import { PlaceFacts, PlaceHero } from './GooglePlace'
import { GeminiMark } from './GeminiMark'
import { FOUND_NO_CROWD, isFound, roleText } from '../lib/found'
import { HourBars } from './HourBars'
import { StopOdai } from './Odai'
import { Sheet } from './Sheet'
import { StopWhy } from './StopWhy'
import { Thumb } from './Thumb'
import { tr } from '../lib/i18n'
import { isEmpty, useTripWhy } from '../lib/why'
import { PLACE_WORDS as W, searchName } from './placeWords'

const ORD = ['th', 'st', 'nd', 'rd']
const T = tr({
  ja: {
    span: (a: string, b: string) => `${a}〜${b}`,
    nearHidden: '近くの隠れた名所',
    others: 'ほかの候補',
    route: 'ここまでの経路',
    unverified: '地図データで位置を確認できませんでした。Google マップでご確認ください。',
    edit: 'この場所の予定',
    stay: '滞在',
    shorter: '滞在を5分短くする',
    longer: '滞在を5分長くする',
    auto: 'おまかせに戻す',
    closes: (t: string) => `${t}に閉まります（目安）。滞在を短くしてください。`,
    order: '順番',
    up: '1つ前にする',
    nth: (n: number) => `${n}番目`,
    down: '1つ後にする',
    reorder: 'スケジュールで並べ替える',
    focus: 'この近くの場所を足す',
    whyAdd: '選んだ理由を残す',
    byGemini: '特徴・注意点・混雑は Gemini の推定です。',
    whySee: '選んだ理由を見る',
  },
  en: {
    span: (a: string, b: string) => `${a}–${b}`,
    nearHidden: 'Hidden Gems Nearby',
    others: 'Other Options',
    route: 'Directions Here',
    unverified: 'We couldn’t confirm this location with map data. Please check it in Google Maps.',
    edit: 'Plans for This Place',
    stay: 'Stay',
    shorter: '5 Minutes Shorter',
    longer: '5 Minutes Longer',
    auto: 'Reset to Automatic',
    closes: (t: string) => `Closes at ${t} (estimate). Please shorten your stay.`,
    order: 'Order',
    up: 'Move Up',
    nth: (n: number) => `${n}${(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 'th' : ORD[n % 10]}`,
    down: 'Move Down',
    reorder: 'Reorder in Schedule',
    focus: 'Add Places Nearby',
    whyAdd: 'Add Your Reason',
    byGemini: 'About, Heads-Up, and Popular Times are estimates by Gemini.',
    whySee: 'See Your Reason',
  },
})

type Props = {
  data: AreaData
  stop: Stop
  index: number
  plan: Plan
  input: PlanInput
  onClose: () => void
  onPeek: (id: string) => void // ほかの候補を押したとき（入れ替える前に、その場所を見る）
  onStay: (id: string, minutes: number) => void
  onAutoStay: (id: string) => void
  onRemove: (stop: Stop) => void
  onFocus: (id: string) => void
  focused: boolean
  fixed: boolean
  date: string
  planDate: string // YYYY-MM-DD
  onNotice: (text: string) => void
  onMove: (id: string, delta: number) => void
  onReorder?: () => void // スケジュールの並べ替えを開く（場所の画面は閉じる）
  odaiCount: number
  whySince: number // この旅を作り始めた時刻（これより後に入れた理由とミッションだけを、この旅の物として出す）
  askWhy?: boolean // 開いたらすぐ「選んだ理由」の欄へ送る（振り返りの画面から来たとき）。送ったら onAskWhy で知らせる
  onAskWhy?: () => void
}

// 滞在の長さの選択肢（15 分〜4 時間・15 分刻み）。細かい長さは −・＋ の 5 分ずつで
const STAYS = Array.from({ length: 16 }, (_, i) => 15 + i * 15)

export function StopSheet({ data, stop, index, plan, input, onClose, onPeek, onStay, onAutoStay, onRemove, onFocus, focused, fixed, date, planDate, onNotice, onMove, onReorder, odaiCount, whySince, askWhy = false, onAskWhy }: Props) {
  const s = stop.spot
  const alts = alternatives(data, stop, plan, input)
  const visitHour = Math.floor((stop.arrive + stop.stay / 2) / 60)
  // 組み直しの途中でも、選んだ長さをそのまま見せる
  const stay = input.stayFix[s.id] ?? stop.stay
  const place = usePlaceInfo(s, data.area)
  // 「選んだ理由を残す」を押したら、シートを広げてから理由の欄まで送る
  const { get: getWhy } = useTripWhy(data.area.name)
  const why = getWhy(s.id)
  const hasWhy = !!why && why.at >= whySince && !isEmpty(why)
  const [toWhy, setToWhy] = useState(0)
  const whyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!toWhy) return
    const t = window.setTimeout(() => {
      const el = whyRef.current?.nextElementSibling
      if (!el) return
      el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      el.querySelector('button')?.focus({ preventScroll: true })
    }, 240)
    return () => window.clearTimeout(t)
  }, [toWhy])
  useEffect(() => {
    if (!askWhy) return
    setToWhy((n) => n + 1)
    onAskWhy?.()
    // onAskWhy は呼んだ側で毎回作り直されるので、頼まれたときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askWhy])
  return (
    <Sheet
      title={
        <>
          <span className="badge num">{index + 1}</span>
          {s.name}
        </>
      }
      lead={
        <span className="lead-row">
          <span>
            {roleText(stop)}
            {W.sep}
            <span className="num">{T.span(fmt(stop.arrive), fmt(stop.depart))}</span>
          </span>
          {stop.estimated && <CrowdMark level={stop.level} word />}
        </span>
      }
      onClose={onClose}
      card
      grow={toWhy}
    >
      <Button variant="ghost" className="why-go" label={hasWhy ? T.whySee : T.whyAdd} endContent={<Icon icon="chevronDown" />} onClick={() => setToWhy((n) => n + 1)} />
      <PlaceHero spot={s} place={place} priority />
      <PlaceFacts info={place.info} date={planDate} />

      <section className="sheet-sec first place-about">
        <Text as="p" display="block" className="reason">
          {stop.reason}
        </Text>
        {!isFound(s) && (
          <dl className="facts">
            <div>
              <dt>{W.why}</dt>
              <dd>
                <GeminiMark />
                {s.why}
              </dd>
            </div>
            <div>
              <dt>{W.downside}</dt>
              <dd>
                <GeminiMark />
                {s.downside}
              </dd>
            </div>
          </dl>
        )}
        <div className="link-row">
          <MapsLink className="text-link" web={mapsDirUrl(stop.leg)} app={mapsAppDirUrl(stop.leg)}>
            {T.route}
          </MapsLink>
          <MapsLink
            className="text-link"
            web={place.info?.mapsUri || mapsPlaceUrl(searchName(s), searchName(data.area))}
            app={mapsAppPlaceUrl(searchName(s), searchName(data.area))}
          >
            {W.maps}
          </MapsLink>
        </div>
        {s.verified === false && (
          <Text as="p" display="block" type="supporting" className="note">
            {T.unverified}
          </Text>
        )}
      </section>

      <section className="sheet-sec">
        <Heading level={3} className="sec-title">
          {W.busy}
        </Heading>
        {isFound(s) ? (
          <Text as="p" display="block" type="supporting" className="note">
            {FOUND_NO_CROWD}
          </Text>
        ) : (
          <>
            <HourBars levels={hourly(s, input.day)} visitHour={visitHour} gaps={s.filled?.crowd} />
            <Text as="p" display="block" type="supporting" className="note">
              <GeminiMark />
              {W.estimate(input.day === 'holiday')}
              {s.basis}
            </Text>
          </>
        )}
      </section>

      <div className="why-anchor" ref={whyRef} />
      <StopWhy area={data.area.name} spot={s} since={whySince} onNotice={onNotice} />

      <StopOdai area={data.area.name} date={date} plan={plan} stop={stop} count={odaiCount} since={whySince} early={daysUntil(planDate) > 0} onNotice={onNotice} />

      <section className="sheet-sec edit" aria-labelledby="edit-title">
        <Heading level={3} id="edit-title" className="sec-title">
          {T.edit}
        </Heading>
        <div className="edit-stay">
          <label className="edit-label" htmlFor="stay-select">
            {T.stay}
          </label>
          <IconButton size="lg" className="step" label={T.shorter} icon={<span className="step-glyph">−</span>} isDisabled={stay <= 10} onClick={() => onStay(s.id, stay - 5)} />
          <span className="stay-pick">
            <select id="stay-select" name="stay" value={stay} onChange={(e) => onStay(s.id, Number(e.target.value))}>
              {[...new Set([...STAYS, stay])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {fmtDur(m)}
                  </option>
                ))}
            </select>
          </span>
          <IconButton size="lg" className="step" label={T.longer} icon={<span className="step-glyph">＋</span>} isDisabled={stay >= 240} onClick={() => onStay(s.id, stay + 5)} />
        </div>
        {fixed && (
          <Button variant="ghost" className="stay-auto" label={T.auto} onClick={() => onAutoStay(s.id)} />
        )}
        {stop.closeOver && (
          <p className="note warn num">
            {T.closes(fmt(s.close))}
          </p>
        )}
        <div className="edit-stay edit-order">
          <span className="edit-label">{T.order}</span>
          <IconButton size="lg" className="step" label={T.up} icon={<Icon icon="arrowUp" />} isDisabled={index <= 0} onClick={() => onMove(s.id, -1)} />
          <span className="order-now num">{T.nth(index + 1)}</span>
          <IconButton size="lg" className="step" label={T.down} icon={<Icon icon="arrowDown" />} isDisabled={index >= plan.stops.length - 1} onClick={() => onMove(s.id, 1)} />
        </div>
        {onReorder && plan.stops.length > 2 && (
          <Button variant="ghost" className="stay-auto" label={T.reorder} onClick={onReorder} />
        )}
        <div className="edit-actions">
          {stop.slot === 'sight' && (
            <ToggleButton label={T.focus} isPressed={focused} onPressedChange={() => onFocus(s.id)} />
          )}
          <Button variant="secondary" label={W.remove} onClick={() => onRemove(stop)} />
        </div>
      </section>

      {alts.length > 0 && (
        <section className="sheet-sec">
          <Heading level={3} className="sec-title">
            {stop.role === '人気スポット' ? T.nearHidden : T.others}
          </Heading>
          <ul className="alts">
            {alts.map((a) => (
              <li key={a.spot.id}>
                <button type="button" className="alt-row" onClick={() => onPeek(a.spot.id)}>
                  <Item
                    as="span"
                    startContent={<Thumb spot={a.spot} />}
                    label={<span className="alt-name">{a.spot.name}</span>}
                    description={a.known ? <CrowdMark level={a.level} word /> : undefined}
                    endContent={<Icon icon="chevronRight" color="secondary" />}
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Text as="p" display="block" type="supporting" className="note ai-note">
        <GeminiMark />
        {T.byGemini}
      </Text>
    </Sheet>
  )
}
