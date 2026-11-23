import { useEffect, useState } from 'react'
import type { Spot } from '../types'
import { spotPhoto, thumbSrcSet, thumbUrl } from '../lib/photo'
import { dropListPhoto, placePhotoUrl, useListPhoto, useLoadedPlaceInfo } from '../lib/place'
import { KIND_ICON, kindOf } from '../lib/kindIcon'

// 行が画面に入ったかを見る。行を送る箱（縦に送れる一番近い親）ごとに 1 つの IntersectionObserver を使い回し、少し手前から見えたことにする
const AHEAD = '160px 0px'
const observers = new Map<Element | null, { io: IntersectionObserver; seen: Map<Element, (on: boolean) => void> }>()

function scroller(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === 'auto' || y === 'scroll') return p
  }
  return null
}

function watch(el: Element, on: (v: boolean) => void): () => void {
  const root = scroller(el)
  let o = observers.get(root)
  if (!o) {
    const seen = new Map<Element, (on: boolean) => void>()
    const io = new IntersectionObserver((list) => list.forEach((e) => seen.get(e.target)?.(e.isIntersecting)), { root, rootMargin: AHEAD })
    o = { io, seen }
    observers.set(root, o)
  }
  const cur = o
  cur.seen.set(el, on)
  cur.io.observe(el)
  return () => {
    cur.io.unobserve(el)
    cur.seen.delete(el)
    on(false)
    if (!cur.seen.size) {
      cur.io.disconnect()
      observers.delete(root)
    }
  }
}

// 一覧の小さな写真（表示は 56px 四方）。場所の画面の大きな写真と同じ 1 枚（spotPhoto・同じ URL）で、作者とライセンスは押した先の大きな写真に出る。
// Google の写真は、場所の画面か候補の画面で取ってある内容を使い、無ければ ask のときだけ、行が画面に入ったら 1 枚目だけを取る（useListPhoto）。
// 写真が無い・読み込めなければ種類のアイコン
// wide のときは、札の幅いっぱいに出すので大きい写真を読む
// photoOnly: 写真が無いときは何も出さない（スケジュールの札。種類の印の四角を写真と混ぜない）。写真を待つ間は、写真と同じ大きさの空の枠
export function Thumb({ spot, wide = false, photoOnly = false, ask = false }: { spot: Spot; wide?: boolean; photoOnly?: boolean; ask?: boolean }) {
  const place = useLoadedPlaceInfo(spot)
  const [el, setEl] = useState<Element | null>(null)
  const [visible, setVisible] = useState(false)
  const list = useListPhoto(spot, ask && !place.info, visible)
  const watching = ask && list.pending
  useEffect(() => (el && watching ? watch(el, setVisible) : undefined), [el, watching])
  const [failed, setFailed] = useState('')
  const info = place.info ?? (list.photo ? { hours: [], mapsUri: '', photos: [list.photo] } : null)
  const ph = spotPhoto(spot, info, failed)
  if (ph?.from === 'google') {
    const name = ph.photo.name
    return (
      <img
        ref={setEl}
        className="thumb"
        src={placePhotoUrl(name)}
        alt=""
        width={56}
        height={56}
        loading="lazy"
        decoding="async"
        onError={() => {
          setFailed(name)
          dropListPhoto(name)
        }}
      />
    )
  }
  if (ph?.from === 'wiki') {
    const url = ph.photo.url
    return (
      <img
        ref={setEl}
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
  if (photoOnly) return list.pending ? <span ref={setEl} className="thumb" aria-hidden="true" /> : null
  return (
    <span ref={setEl} className="thumb thumb-kind" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24">
        {KIND_ICON[kindOf(spot)].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  )
}
