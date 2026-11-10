// 地図の部品は、使う方（Google マップか MapLibre）だけを読み込む。読み込んでいる間は、同じ大きさの空の地図の枠を出す
import { Suspense, lazy, type ComponentType } from 'react'
import { giveUpGoogleMaps } from '../lib/gmaps'
import type { MapProps } from './mapShared'

const hold = (
  <div className="map-wrap">
    <div className="map" />
  </div>
)
const Hold: ComponentType<MapProps> = () => hold

const MapLibreMap = lazy(() =>
  import('./MapView').then(
    (m): { default: ComponentType<MapProps> } => ({ default: m.MapView }),
    () => ({ default: Hold }),
  ),
)
// Google マップの部品を読み込めなかったときは、Google マップを読めなかったときと同じく MapLibre に戻す
const GoogleMap = lazy(() =>
  import('./GoogleMapView').then(
    (m): { default: ComponentType<MapProps> } => ({ default: m.GoogleMapView }),
    () => {
      giveUpGoogleMaps()
      return { default: Hold }
    },
  ),
)

export function MapView(p: MapProps) {
  return (
    <Suspense fallback={hold}>
      <MapLibreMap {...p} />
    </Suspense>
  )
}

export function GoogleMapView(p: MapProps) {
  return (
    <Suspense fallback={hold}>
      <GoogleMap {...p} />
    </Suspense>
  )
}
