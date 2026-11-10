import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import type { Leg, LegMode } from '../lib/geo'
import { mapsAppDirUrl, mapsDirUrl } from '../lib/geo'
import { tr } from '../lib/i18n'
import { MapsLink } from './MapsLink'
import { Sheet } from './Sheet'

const T = tr({
  ja: {
    title: '移動の手段',
    walkNow: (m: number) => `歩いて${m}分です。`,
    toWalk: (m: number) => `歩いて行く（約${m}分）`,
    toTransit: (m: number) => `電車・バスにする（約${m}分）`,
    auto: '手段を自動に戻す',
    chosen: '手段は自分で選んでいます。',
    maps: 'Google マップで経路を見る',
  },
  en: {
    title: 'Getting There',
    walkNow: (m: number) => `${m} min on foot.`,
    toWalk: (m: number) => `Walk Instead (~${m} min)`,
    toTransit: (m: number) => `Take Transit Instead (~${m} min)`,
    auto: 'Let the App Choose',
    chosen: 'You chose how to get there.',
    maps: 'See the Route in Google Maps',
  },
})

// 区間の手段（徒歩・電車とバス）を切り替える。もう片方の手段の目安の分を添え、自分で選んだ区間には「自動に戻す」を出す
export function LegModeChoice({ leg, onMode }: { leg: Leg; onMode: (m: LegMode | null) => void }) {
  const next: LegMode = leg.mode === 'walk' ? 'transit' : 'walk'
  return (
    <div className="leg-mode">
      {leg.other != null && (
        <Button variant="secondary" size="lg" width="100%" label={next === 'walk' ? T.toWalk(leg.other) : T.toTransit(leg.other)} onClick={() => onMode(next)} />
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

// 歩く区間を押したときのシート（電車・バスの区間は、便の画面か経路の画面に同じ切り替えを出す）
export function LegModeSheet({ fromName, toName, leg, onMode, onClose }: { fromName: string; toName: string; leg: Leg; onMode: (m: LegMode | null) => void; onClose: () => void }) {
  return (
    <Sheet title={T.title} lead={`${fromName} → ${toName}`} onClose={onClose} card>
      <Text as="p" display="block" className="leg-mode-now num">
        {T.walkNow(leg.minutes)}
      </Text>
      <LegModeChoice leg={leg} onMode={onMode} />
      <p className="bus-maps">
        <MapsLink className="leg-action" web={mapsDirUrl(leg)} app={mapsAppDirUrl(leg)}>
          {T.maps}
        </MapsLink>
      </p>
    </Sheet>
  )
}
