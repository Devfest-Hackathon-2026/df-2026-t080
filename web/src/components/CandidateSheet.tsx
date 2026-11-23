import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import type { AreaData, Spot } from '../types'
import { hourly, peakRange } from '../lib/crowd'
import { isEmpty, useTripWhy } from '../lib/why'
import { mapsAppPlaceUrl, mapsPlaceUrl } from '../lib/geo'
import { usePlaceInfo } from '../lib/place'
import type { Day } from '../lib/crowd'
import { GeminiMark } from './GeminiMark'
import { FOUND_NO_CROWD, FOUND_ROLE, isFound } from '../lib/found'
import { PlaceFacts, PlaceHero, PlaceRating } from './GooglePlace'
import { CrowdMark } from './CrowdMark'
import { HourBars } from './HourBars'
import { MapsLink } from './MapsLink'
import { Sheet } from './Sheet'
import { WHY_SAVED, WhyField, type WhyDraft } from './WhyField'
import { tr } from '../lib/i18n'
import { PLACE_WORDS as W, searchName } from './placeWords'

const T = tr({
  ja: { swap: '入れ替える', add: 'プランに追加', later: '「プランに追加」をタップすると保存されます' },
  en: { swap: 'Swap', add: 'Add to Plan', later: 'Saved when you tap Add to Plan' },
})


// 行きたい場所に選んである候補。whySince より後に入れた理由だけを、選んだときの理由として出す
export type PickedCandidate = { whySince: number; onRemove: (id: string) => void }

// 地図の候補の印を押したときの画面。どんな所かを見て、理由を添えてプランに入れられる。選んであれば、外せる。
// onSwap があるときは、場所の画面の「ほかの候補」から開いた画面で、入れ替えるか、前の画面に戻るかを選ぶ。
// card: 暗幕なしで下半分に開く（false なら、ほかのシートと同じ高さで開く）。back: 閉じる代わりに前の画面へ戻る
export function CandidateSheet({
  data,
  spot,
  day,
  planDate,
  picked,
  onAdd,
  onSwap,
  onClose,
  onNotice,
  card = true,
  back,
  visitHour = -1,
}: {
  data: AreaData
  spot: Spot
  day: Day
  planDate: string // YYYY-MM-DD
  picked?: PickedCandidate
  onAdd?: (id: string) => void
  onSwap?: () => void
  onClose: () => void
  onNotice: (text: string) => void
  card?: boolean
  back?: boolean
  // 今の予定で訪ねる時間帯（入れ替える前の場所の時刻。無ければ -1）。混雑の棒に印を付ける
  visitHour?: number
}) {
  const role = isFound(spot) ? FOUND_ROLE : spot.kind === 'food' || spot.kind === 'cafe' ? W.kind[spot.kind] : spot.role === 'famous' ? W.famous : (spot.theme ?? W.hidden)
  const place = usePlaceInfo(spot, data.area)
  const levels = hourly(spot, day)
  const peak = isFound(spot) ? null : peakRange(spot, day)
  const peakLv = Math.max(...levels.filter((_, i) => !spot.filled?.crowd?.includes(i)))
  const { get, put } = useTripWhy(data.area.name)
  const [draft, setDraft] = useState<WhyDraft>({ chips: [], text: '' })
  const [stored, setStored] = useState(false)
  const saved = get(spot.id)
  const mine = picked && saved && saved.at >= picked.whySince ? saved : undefined
  // 選んである場所の理由は、直したらすぐ保存する
  const editPicked = (v: WhyDraft) => {
    if (!put({ spotId: spot.id, spotName: spot.name, chips: v.chips, text: v.text, downsideSeen: mine?.downsideSeen ?? spot.downside, hit: mine?.hit, at: mine?.at ?? Date.now() })) {
      onNotice(W.noRoom)
      setStored(false)
    } else setStored(true)
  }
  // 理由が入っていれば、欠点を見たうえで選んだ記録として残してから、プランに追加
  const add = () => {
    if (!isEmpty(draft) && !put({ spotId: spot.id, spotName: spot.name, chips: draft.chips, text: draft.text.trim(), downsideSeen: spot.downside, at: Date.now() })) {
      onNotice(W.noRoom)
    }
    onAdd?.(spot.id)
  }
  // 食事とカフェは、メニューと口コミを見に行くリンクを、特徴と注意点のすぐ下に出す（ほかの場所は画面の下）
  const eats = spot.kind === 'food' || spot.kind === 'cafe'
  const mapsLink = (
    <div className="link-row">
      <MapsLink
        className="text-link"
        web={place.info?.mapsUri || mapsPlaceUrl(searchName(spot), searchName(data.area))}
        app={mapsAppPlaceUrl(searchName(spot), searchName(data.area))}
      >
        {eats ? W.mapsMenu : W.maps}
      </MapsLink>
    </div>
  )
  return (
    <Sheet
      title={spot.name}
      lead={
        <>
          <span className="cand-lead cand-meta">
            <span>{[role, spot.district].filter(Boolean).join(W.sep)}</span>
            <PlaceRating info={place.info} />
          </span>
          {peak && (
            <span className="cand-lead cand-peak">
              <span className="num">{peak}</span>
              <CrowdMark level={peakLv} />
            </span>
          )}
        </>
      }
      onClose={onClose}
      card={card}
      back={back ?? !!onSwap}
    >
      <PlaceHero spot={spot} place={place} />
      {!isFound(spot) && (
      <dl className="facts cand-facts">
        {spot.why && (
          <div>
            <dt>{W.why}</dt>
            <dd>
              <GeminiMark />
              {spot.why}
            </dd>
          </div>
        )}
        <div>
          <dt>{W.downside}</dt>
          <dd>
            <GeminiMark />
            {spot.downside}
          </dd>
        </div>
      </dl>
      )}
      {eats && mapsLink}
      <PlaceFacts info={place.info} date={planDate} rating={false} />
      <section className="sheet-sec cand-crowd">
        <Heading level={3} className="sec-title">
          {W.busy}
        </Heading>
        {isFound(spot) ? (
          <Text as="p" display="block" type="supporting" className="note">
            {FOUND_NO_CROWD}
          </Text>
        ) : (
          <>
            <HourBars levels={levels} visitHour={visitHour} gaps={spot.filled?.crowd} />
            <Text as="p" display="block" type="supporting" className="note">
              <GeminiMark />
              {W.estimate(day === 'holiday')}
              {spot.basis}
            </Text>
          </>
        )}
      </section>
      {!onSwap &&
        (picked ? (
          <WhyField value={{ chips: mine?.chips ?? [], text: mine?.text ?? '' }} onChange={editPicked} status={stored ? WHY_SAVED : ''} />
        ) : (
          <WhyField want value={draft} onChange={setDraft} status={isEmpty(draft) || !onAdd ? '' : T.later} />
        ))}
      {!eats && mapsLink}
      <div className="cand-bar">
        {onSwap ? (
          <Button variant="primary" size="lg" width="100%" label={T.swap} onClick={onSwap} />
        ) : picked ? (
          <Button variant="secondary" size="lg" width="100%" className="cand-remove" label={W.remove} onClick={() => picked.onRemove(spot.id)} />
        ) : (
          <Button variant="primary" size="lg" width="100%" label={T.add} onClick={add} />
        )}
      </div>
    </Sheet>
  )
}
