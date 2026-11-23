import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import type { Leg, LegMode } from '../lib/geo'
import { mapsAppDirUrl, mapsDirUrl } from '../lib/geo'
import { tr } from '../lib/i18n'
import { fmtDur } from '../lib/time'
import { MapsLink } from './MapsLink'
import { slopeLook, type Slope } from '../lib/slope'
import { distText, useWalkMeters } from '../lib/walkDist'
import { Sheet } from './Sheet'

const T = tr({
  ja: {
    title: '移動の手段',
    walkNow: (m: number) => `徒歩${m}分です。`,
    carNow: (m: number) => `車で${fmtDur(m)}です。`,
    toWalk: (m: number) => `徒歩（約${fmtDur(m)}）`,
    toTransit: (m: number) => `電車・バス（約${m}分）`,
    toCar: (m: number) => `車（約${fmtDur(m)}）`,
    auto: '手段を自動に戻す',
    chosen: '移動の手段は手動で選択されています。',
    maps: 'Google マップで経路を見る',
    sep: '・',
  },
  en: {
    title: 'Getting There',
    walkNow: (m: number) => `${m} min on foot.`,
    carNow: (m: number) => `${fmtDur(m)} by car.`,
    toWalk: (m: number) => `Walk Instead (~${fmtDur(m)})`,
    toTransit: (m: number) => `Take Transit Instead (~${m} min)`,
    toCar: (m: number) => `Drive Instead (~${fmtDur(m)})`,
    auto: 'Let the App Choose',
    chosen: 'You chose how to get there.',
    maps: 'See the Route in Google Maps',
    sep: ' · ',
  },
})

// 区間の手段（徒歩・電車とバス。車で回る旅は徒歩・車）を切り替える。もう片方の手段の目安の分を添え、自分で選んだ区間には「自動に戻す」を出す
export function LegModeChoice({ leg, onMode, car = false }: { leg: Leg; onMode: (m: LegMode | null) => void; car?: boolean }) {
  const next: LegMode = leg.mode !== 'walk' ? 'walk' : car ? 'car' : 'transit'
  return (
    <div className="leg-mode">
      {leg.other != null && (
        <Button variant="secondary" size="lg" width="100%" label={next === 'walk' ? T.toWalk(leg.other) : next === 'car' ? T.toCar(leg.other) : T.toTransit(leg.other)} onClick={() => onMode(next)} />
      )}
      {leg.chosen && (
        <>
          <Text as="p" display="block" type="supporting" className="note">
            {T.chosen}
          </Text>
          <Button variant="ghost" label={T.auto} onClick={() => onMode(null)} />
        </>
      )}
    </div>
  )
}

// 歩く区間と車の区間を押したときのシート（電車・バスの区間は、便の画面か経路の画面に同じ切り替えを出す）
export function LegModeSheet({ fromName, toName, leg, slope, car = false, onMode, onClose }: { fromName: string; toName: string; leg: Leg; slope?: Slope | null; car?: boolean; onMode: (m: LegMode | null) => void; onClose: () => void }) {
  const [meters] = useWalkMeters([leg])
  const hill = leg.mode === 'walk' ? slopeLook(slope) : null
  const about = [meters != null && distText(meters), hill?.label].filter(Boolean).join(T.sep)
  return (
    <Sheet title={T.title} lead={`${fromName} → ${toName}`} onClose={onClose} card>
      <Text as="p" display="block" className="leg-mode-now num">
        {leg.mode === 'car' ? T.carNow(leg.minutes) : T.walkNow(leg.minutes)}
      </Text>
      {about && (
        <Text as="p" display="block" type="supporting" className="note num">
          {about}
        </Text>
      )}
      <LegModeChoice leg={leg} onMode={onMode} car={car} />
      <p className="bus-maps">
        <MapsLink className="leg-action" web={mapsDirUrl(leg)} app={mapsAppDirUrl(leg)}>
          {T.maps}
        </MapsLink>
      </p>
    </Sheet>
  )
}
