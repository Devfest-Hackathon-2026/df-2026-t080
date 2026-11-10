import { Fragment, useState } from 'react'
import type { Spot } from '../types'
import { HERO_SIZES, spotPhoto, thumbUrl, usesGooglePhoto, wikiHeroSet } from '../lib/photo'
import { placePhotoUrl, weekIndex, type PlaceInfo, type PlaceState } from '../lib/place'
import { dateLabel, isoDate } from '../lib/time'
import { tr } from '../lib/i18n'
import { WikiCredit } from './PhotoCredit'

const T = tr({
  ja: {
    photo: '写真:',
    comma: '、',
    maps: 'Google マップ',
    via: '（Google マップ）',
    locale: 'ja-JP',
    today: '今日',
    rating: (r: string, c: string, _n: number) => `評価 ${r}（5 点中）・${c} 件`,
    count: (c: string) => `${c} 件`,
  },
  en: {
    photo: 'Photo:',
    comma: ', ',
    maps: 'Google Maps',
    via: ' (Google Maps)',
    locale: 'en-US',
    today: 'Today',
    rating: (r: string, c: string, n: number) => `Rated ${r} out of 5 · ${c} ${n === 1 ? 'review' : 'reviews'}`,
    count: (c: string) => `(${c})`,
  },
})

// 場所の写真（spotPhoto の 1 枚。一覧の小さな写真と同じ）。Google の写真には投稿者と Google マップの帰属を、Wikipedia の写真には作者とライセンスを添える。
// Google の写真を使う場所で Places の内容を待っている間は、同じ大きさの枠だけを出す。読み込めなかった写真は、枠ごと出さない
export function PlaceHero({ spot, place, priority = false }: { spot: Spot; place: PlaceState; priority?: boolean }) {
  const [failed, setFailed] = useState('')
  const ph = spotPhoto(spot, place.info, failed)
  if (ph?.from === 'google') return <GoogleHero photo={ph.photo} alt={spot.name} priority={priority} onError={() => setFailed(ph.photo.name)} />
  if (ph?.from === 'wiki') {
    const w = ph.photo
    return (
      <figure className="hero">
        <img
          src={thumbUrl(w.url, 960)}
          srcSet={wikiHeroSet(w.url)}
          sizes={HERO_SIZES}
          alt={spot.name}
          width={960}
          height={600}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onError={() => setFailed(w.url)}
        />
        <figcaption>
          {T.photo} <WikiCredit photo={w} />
        </figcaption>
      </figure>
    )
  }
  if (place.waiting && usesGooglePhoto(spot)) {
    return (
      <figure className="hero" aria-hidden="true">
        <div className="hero-wait" />
        <figcaption>&nbsp;</figcaption>
      </figure>
    )
  }
  return null
}

type GooglePhoto = PlaceInfo['photos'][number]

// Google の写真 1 枚と、投稿者と Google マップの帰属（場所の画面と、この付近で検索の結果で使う。写真は取っておかない）
export function GoogleHero({ photo: g, alt, priority = false, onError }: { photo: GooglePhoto; alt: string; priority?: boolean; onError: () => void }) {
  return (
    <figure className="hero">
      <img src={placePhotoUrl(g.name)} alt={alt} width={960} height={600} decoding="async" fetchPriority={priority ? 'high' : 'auto'} onError={onError} />
      <figcaption>
        {T.photo}{' '}
        {g.authors.length > 0
          ? g.authors.map((a, i) => (
              <Fragment key={`${i}-${a.name}`}>
                {i > 0 && T.comma}
                {a.uri ? (
                  <a href={a.uri} target="_blank" rel="noreferrer">
                    {a.name}
                  </a>
                ) : (
                  a.name
                )}
              </Fragment>
            ))
          : T.maps}
        {g.authors.length > 0 && T.via}
      </figcaption>
    </figure>
  )
}

// 形の出典: Feather（https://feathericons.com）の star を 0.94 倍にした形（座標は AI（Claude）が書き直したもので、path の文字は一致しない）。
// MIT ライセンス。著作権は Cole Bemis
const STAR = 'M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z'

// 5 つの星。端数の分は星の左から途中まで塗る
function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="star">
          <svg viewBox="0 0 24 24">
            <path d={STAR} />
          </svg>
          <span className="star-on" style={{ width: `${Math.round(Math.min(1, Math.max(0, value - i)) * 100)}%` }}>
            <svg viewBox="0 0 24 24">
              <path d={STAR} />
            </svg>
          </span>
        </span>
      ))}
    </span>
  )
}

// Google マップの評価と、プランの日の営業時間（押すと 1 週間の分を開く）
export function PlaceFacts({ info, date }: { info: PlaceInfo | null; date: string }) {
  if (!info) return null
  const stars = typeof info.rating === 'number' && typeof info.count === 'number' && info.count > 0 ? info.rating : null
  const rating = stars === null ? '' : stars.toFixed(1)
  const count = stars === null ? '' : (info.count ?? 0).toLocaleString(T.locale)
  const dayIdx = weekIndex(date)
  const when = date === isoDate(new Date()) ? T.today : dateLabel(date)
  const hours = info.hours.length === 7 ? info.hours : []
  if (!rating && !hours.length) return null
  return (
    <div className="gplace">
      {stars !== null && (
        <p className="gplace-rating num" role="img" aria-label={T.rating(rating, count, info.count ?? 0)}>
          <span aria-hidden="true">{rating}</span>
          <Stars value={stars} />
          <span className="gplace-count" aria-hidden="true">
            {T.count(count)}
          </span>
        </p>
      )}
      {hours.length > 0 && (
        <details className="gplace-hours">
          <summary className="num">
            {when} {hours[dayIdx].text}
          </summary>
          <ul>
            {hours.map((h, i) => (
              <li key={h.day} aria-current={i === dayIdx ? 'date' : undefined}>
                <span>{h.day}</span>
                <span className="num">{h.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
