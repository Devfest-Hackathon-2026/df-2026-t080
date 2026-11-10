// 時刻表から選んだ便の区間は、地図の線を道の線から「停留所まで歩く・路線の線・停留所から歩く」にする。
// 地図は区間ごとの線（lineCache）を使って描くので、選んだ便の区間の線をそこに入れておく。便を外したら消して、道の線に戻す
import type { AreaData, TransitRoute } from '../types'
import { legKey, lineCache, type LL } from '../components/mapShared'
import { pointsById } from './geo'
import { busParts, joinParts } from './bus'

const mine = new Set<string>()

export function syncBusLines(data: AreaData, overrides: Record<string, TransitRoute>) {
  const byId = pointsById(data)
  const now = new Set<string>()
  for (const [k, r] of Object.entries(overrides)) {
    const bus = r.bus
    if (!bus || bus.line.length < 2) continue
    const [ia, ib] = k.split('>')
    const a = byId.get(ia)
    const b = byId.get(ib)
    if (!a || !b) continue
    const A: LL = [a.lng, a.lat]
    const B: LL = [b.lng, b.lat]
    const key = legKey(A, B, 'transit')
    lineCache.set(key, joinParts(busParts(bus, A, B)))
    now.add(key)
  }
  for (const key of mine) if (!now.has(key)) lineCache.delete(key)
  mine.clear()
  now.forEach((k) => mine.add(k))
}
