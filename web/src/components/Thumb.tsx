import { useState } from 'react'
import type { Spot } from '../types'
import { spotPhoto, thumbSrcSet, thumbUrl } from '../lib/photo'
import { placePhotoUrl, useLoadedPlaceInfo } from '../lib/place'
import { KIND_ICON, kindOf } from '../lib/kindIcon'

// 一覧の小さな写真（表示は 56px 四方）。場所の画面の大きな写真と同じ 1 枚（spotPhoto・同じ URL）で、作者とライセンスは押した先の大きな写真に出る。
// Google の写真は、場所の画面か候補の画面で取ってある内容だけを使う（自分では取らない）。写真が無い・読み込めなければ種類のアイコン
// wide のときは、札の幅いっぱいに出すので大きい写真を読む
// photoOnly: 写真が無いときは何も出さない（スケジュールの札。種類の印の四角を写真と混ぜない）
export function Thumb({ spot, wide = false, photoOnly = false }: { spot: Spot; wide?: boolean; photoOnly?: boolean }) {
  const place = useLoadedPlaceInfo(spot)
  const [failed, setFailed] = useState('')
  const ph = spotPhoto(spot, place.info, failed)
  if (ph?.from === 'google') {
    const name = ph.photo.name
    return <img className="thumb" src={placePhotoUrl(name)} alt="" width={56} height={56} loading="lazy" decoding="async" onError={() => setFailed(name)} />
  }
  if (ph?.from === 'wiki') {
    const url = ph.photo.url
    return (
      <img
        className="thumb"
        src={thumbUrl(url, wide ? 960 : 250)}
        srcSet={wide ? undefined : thumbSrcSet(url)}
        alt=""
        width={56}
        height={56}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(url)}
      />
    )
  }
  if (photoOnly) return null
  return (
    <span className="thumb thumb-kind" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24">
        {KIND_ICON[kindOf(spot)].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  )
}
