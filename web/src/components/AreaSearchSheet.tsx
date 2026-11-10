import { Button } from '@astryxdesign/core/Button'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { useEffect, useState, type FormEvent } from 'react'
import type { Found, FoundError } from '../lib/areaSearch'
import { usePlaceById } from '../lib/place'
import { isEn, tr } from '../lib/i18n'
import { dayHours, dayHoursText, openAt, openDuring } from '../lib/hours'
import { fmt } from '../lib/time'
import { MapsLink } from './MapsLink'
import { FOUND_NO_CROWD } from '../lib/found'
import { GoogleHero, PlaceFacts } from './GooglePlace'
import { Sheet } from './Sheet'

const T = tr({
  ja: {
    title: 'この付近を検索',
    lead: '地図に写っている範囲で探します',
    label: '探す物',
    placeholder: 'カフェ、ラーメン、お土産……',
    search: '検索',
    chips: [
      ['カフェ', 'カフェ'],
      ['ごはん', 'レストラン'],
      ['甘味', '甘味処'],
      ['お土産', 'お土産'],
    ],
    busy: 'この付近を探しています……',
    none: 'この範囲では見つかりませんでした。',
    wide: '範囲が広すぎます。地図を拡大してから、もう一度お試しください。',
    limit: '今は検索できません。しばらくしてから、もう一度お試しください。',
    unavailable: '検索できませんでした。もう一度お試しください。',
    offline: 'サーバーにつながりません。通信を確かめて、もう一度お試しください。',
    rating: (r: number, c: number) => `評価 ${r.toFixed(1)}（${c.toLocaleString('ja-JP')}件）`,
    openAt: (t: string) => `${t} は営業中`,
    closedAt: (t: string) => `${t} は営業時間外`,
    outTrip: '旅の時間は営業時間外',
    sep: '・',
    maps: 'Google マップで見る',
    candidate: '候補の画面を開く',
    add: 'プランに入れる',
    inPlan: 'プランに入っています',
    loading: '詳しい情報を読み込んでいます……',
    credit: '検索: Google マップ',
  },
  en: {
    title: 'Search This Area',
    lead: 'Searches the area shown on the map',
    label: 'What to find',
    placeholder: 'Cafe, ramen, souvenirs…',
    search: 'Search',
    chips: [
      ['Cafes', 'cafe'],
      ['Food', 'restaurant'],
      ['Sweets', 'Japanese sweets'],
      ['Souvenirs', 'souvenir shop'],
    ],
    busy: 'Searching this area…',
    none: 'Nothing found in this area.',
    wide: 'The area is too large. Zoom in on the map and try again.',
    limit: 'Search isn’t available right now. Please try again later.',
    unavailable: 'Couldn’t search. Please try again.',
    offline: 'Can’t reach the server. Check your connection and try again.',
    rating: (r: number, c: number) => `${r.toFixed(1)} (${c.toLocaleString('en-US')})`,
    openAt: (t: string) => `Open at ${t}`,
    closedAt: (t: string) => `Closed at ${t}`,
    outTrip: 'Closed during your trip',
    sep: ' · ',
    maps: 'View in Google Maps',
    candidate: 'Open the Candidate',
    add: 'Add to Plan',
    inPlan: 'In your plan',
    loading: 'Loading details…',
    credit: 'Search: Google Maps',
  },
})

// Google マップの場所の URL（https://developers.google.com/maps/documentation/urls/get-started の search）。アプリでもブラウザでも開ける
const mapsUrl = (f: Found) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.name)}&query_place_id=${encodeURIComponent(f.id)}`

type Props = {
  q: string // 最後に探した言葉（ほかの画面から戻ったときに、欄に戻す）
  busy: boolean
  error: FoundError | null
  found: Found[] | null // null はまだ探していない
  picked: string | null // 開いている結果の place_id
  date: string
  span: [number, number] // 旅の出発と帰る時刻（0 時からの分）
  visitAt: (placeId: string) => number | null // プランに入っている場所なら、着く時刻（0 時からの分）
  candidateOf: (placeId: string) => string | null // 候補にある場所なら、その候補の id
  inPlan: (spotId: string) => boolean // その候補が、もうプランに入っている
  onSearch: (q: string) => void
  onPick: (placeId: string | null) => void
  onCandidate: (spotId: string) => void
  onAdd: (spotId: string) => void
  onAddFound: (f: Found) => void // 候補に無い場所を、新しい候補にしてプランに入れる
  onClose: () => void
}

// 結果を押したときに開く、写真・評価・営業時間と、プランに入れるボタンと、Google マップ・候補の画面への道。
// 候補にある場所はその候補を入れ、候補に無い場所は新しい候補にして入れる（混雑の推定は無い）
function FoundDetail({ f, date, spotId, inPlan, onCandidate, onAdd, onAddFound }: { f: Found; date: string; spotId: string | null; inPlan: boolean; onCandidate: (id: string) => void; onAdd: (id: string) => void; onAddFound: (f: Found) => void }) {
  const place = usePlaceById(f.id)
  const [failed, setFailed] = useState('')
  const url = place.info?.mapsUri || mapsUrl(f)
  const photo = place.info?.photos.find((p) => p.name !== failed)
  return (
    <div className="as-detail">
      {place.waiting && <p className="note pulse">{T.loading}</p>}
      {photo && <GoogleHero photo={photo} alt={f.name} onError={() => setFailed(photo.name)} />}
      <PlaceFacts info={place.info} date={date} />
      {inPlan ? (
        <p className="note as-in-plan">{T.inPlan}</p>
      ) : (
        <Button variant="primary" className="as-add" label={T.add} onClick={() => (spotId ? onAdd(spotId) : onAddFound(f))} />
      )}
      {!spotId && <p className="note as-no-crowd">{FOUND_NO_CROWD}</p>}
      <p className="as-actions">
        <MapsLink className="leg-action" web={url} app={url}>
          {T.maps}
        </MapsLink>
        {spotId && (
          <Button variant="ghost" className="leg-action" label={T.candidate} onClick={() => onCandidate(spotId)} />
        )}
      </p>
    </div>
  )
}

// この付近で検索のシート。暗幕を置かずに開き、上の地図で結果の印を見られるようにする
export function AreaSearchSheet({ q: last, busy, error, found, picked, date, span, visitAt, candidateOf, inPlan, onSearch, onPick, onCandidate, onAdd, onAddFound, onClose }: Props) {
  const [q, setQ] = useState(last)
  // 地図の印を押して開いた結果は、一覧のその行まで送る
  useEffect(() => {
    if (picked) document.getElementById(`as-${picked}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [picked])
  const go = (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setQ(t)
    onSearch(t)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    go(q)
  }
  const meta = (f: Found) => [f.type, f.rating != null && f.count ? T.rating(f.rating, f.count) : ''].filter(Boolean).join(T.sep)
  // 旅の日の営業時間と、着く時刻（プランに入っている場所）か旅の時間に開いているか。開いていなければ注意の色にする
  const hours = (f: Found): { text: string; shut: boolean } | null => {
    const spans = dayHours(f.hours, date)
    const day = dayHoursText(f.hours, date)
    if (!spans || !day) return null
    if (!dayHours(f.hours, date, false)?.length) return { text: day, shut: true }
    const at = visitAt(f.id)
    if (at !== null) return { text: `${day}${T.sep}${openAt(spans, at) ? T.openAt(fmt(at)) : T.closedAt(fmt(at))}`, shut: !openAt(spans, at) }
    if (!openDuring(spans, span[0], span[1])) return { text: `${day}${T.sep}${T.outTrip}`, shut: true }
    return { text: day, shut: false }
  }
  return (
    <Sheet title={T.title} lead={T.lead} onClose={onClose} card>
      <form className="as-form" role="search" onSubmit={submit}>
        <input
          type="search"
          className="as-input"
          aria-label={T.label}
          placeholder={T.placeholder}
          value={q}
          maxLength={60}
          enterKeyHint="search"
          lang={isEn ? 'en' : 'ja'}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="primary" className="as-go" label={T.search} isDisabled={busy || !q.trim()} />
      </form>
      <div className="as-chips">
        {T.chips.map(([label, word]) => (
          <ToggleButton key={label} size="sm" label={label} isPressed={q === word} isDisabled={busy} onPressedChange={() => go(word)} />
        ))}
      </div>
      <div aria-live="polite">
        {busy && <p className="note pulse">{T.busy}</p>}
        {!busy && error && <p className="note warn">{T[error]}</p>}
        {!busy && !error && found && !found.length && <p className="note">{T.none}</p>}
      </div>
      {!busy && found && found.length > 0 && (
        <ul className="as-list">
          {found.map((f) => {
            const on = picked === f.id
            const h = hours(f)
            return (
              <li key={f.id} id={`as-${f.id}`} className="as-item" data-on={on ? '' : undefined}>
                <button type="button" className="as-row" aria-expanded={on} onClick={() => onPick(on ? null : f.id)}>
                  <span className="as-text">
                    <span className="as-name">{f.name}</span>
                    {meta(f) && <span className="as-meta num">{meta(f)}</span>}
                    {h && (
                      <span className="as-meta as-hours num" data-shut={h.shut || undefined}>
                        {h.text}
                      </span>
                    )}
                  </span>
                </button>
                {on && (() => {
                  const spotId = candidateOf(f.id)
                  return <FoundDetail f={f} date={date} spotId={spotId} inPlan={!!spotId && inPlan(spotId)} onCandidate={onCandidate} onAdd={onAdd} onAddFound={onAddFound} />
                })()}
              </li>
            )
          })}
        </ul>
      )}
      {found && found.length > 0 && <p className="note as-credit">{T.credit}</p>}
    </Sheet>
  )
}
