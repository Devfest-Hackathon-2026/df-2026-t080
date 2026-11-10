import { tr } from '../lib/i18n'

const T = tr({
  ja: { label: '経路と位置:', sep: '・', report: '地図の問題を報告' },
  en: { label: 'Routes and locations:', sep: ' · ', report: 'Report a Map Issue' },
})

// 経路（OSRM）と位置の確かめ（Nominatim）に使った OpenStreetMap のデータの出典と、地図の問題を報告する所。
// label: 何に使ったか（無ければ「経路と位置:」）
export function OsmCredit({ className, label }: { className?: string; label?: string }) {
  return (
    <p className={className ? `osm-credit ${className}` : 'osm-credit'}>
      {label ?? T.label}{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
      {T.sep}
      <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
        {T.report}
      </a>
    </p>
  )
}
