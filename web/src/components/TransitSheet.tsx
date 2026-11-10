import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { useEffect, useRef, useState } from 'react'
import type { TransitRoute } from '../types'
import { loggedFetch } from '../lib/apiLog'
import { mapsAppDirUrl, mapsDirUrl, type Leg, type LegMode } from '../lib/geo'
import { MapsLink } from './MapsLink'
import { Sheet } from './Sheet'
import { LegModeChoice } from './LegMode'
import { askMapRedraw } from './mapShared'
import { TransitSteps } from './TransitSteps'
import { lang, tr } from '../lib/i18n'

type Props = {
  fromName: string
  toName: string
  leg: Leg
  noTable?: boolean // このエリアにバスの時刻表が無い
  onSave: (r: TransitRoute) => void
  onRemove: () => void
  onMode: (m: LegMode | null) => void // 区間の手段を選ぶ（null は自動に戻す）
  onClose: () => void
}

// スクリーンショットを小さくしてから送る（長い辺を 1600px まで・JPEG）
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const T = tr({
  ja: {
    errors: {
      notfound: '経路を読み取れませんでした。経路の画面全体が写るように撮って、もう一度お試しください。',
      quota: 'Gemini の利用上限に近いため、読み取れません。しばらくしてから、もう一度お試しください。',
      image: 'この画像は読み込めません。PNG か JPEG のスクリーンショットを選んでください。',
      large: '画像が大きすぎます。スクリーンショットを選んでください。',
      failed: '読み取りに失敗しました。もう一度お試しください。',
    } as Record<string, string>,
    title: '電車・バスの経路と時刻',
    noTable: 'このエリアのバスの時刻表には、まだ対応していません。',
    shot: '実際の時刻に合わせる（任意）',
    why: 'スケジュールのこの区間の時間を、実際の電車・バスの時刻に直します。',
    step1: 'Google マップか乗換案内で、この区間の経路を出してください。',
    maps: 'Google マップで経路を開く',
    step2: '経路の画面のスクリーンショットを選ぶと、Gemini が路線・駅・時刻を読み取ります。',
    reading: '読み取っています……',
    choose: 'スクリーンショットを選ぶ',
    found: '読み取った経路',
    add: 'このプランに入れる',
    rebuild: '読み取った所要時間で、スケジュールを組み直します。',
    remove: '入れた経路を外す',
    saved: '入れた経路',
  },
  en: {
    errors: {
      notfound: 'Couldn’t read a route. Take a screenshot that shows the whole route, then try again.',
      quota: 'Gemini is near its usage limit, so the screenshot can’t be read now. Please try again later.',
      image: 'This image can’t be read. Choose a PNG or JPEG screenshot.',
      large: 'The image is too large. Choose a screenshot.',
      failed: 'Couldn’t read the screenshot. Please try again.',
    },
    title: 'Transit Route and Times',
    noTable: 'Bus timetables aren’t available for this area yet.',
    shot: 'Match the Real Times (Optional)',
    why: 'Updates this leg in your schedule to the real train and bus times.',
    step1: 'Show the route for this leg in Google Maps or a transit app.',
    maps: 'Directions in Google Maps',
    step2: 'Choose a screenshot of the route, and Gemini will read the lines, stations, and times.',
    reading: 'Reading…',
    choose: 'Choose Screenshot',
    found: 'Route Found',
    add: 'Add to This Plan',
    rebuild: 'Your schedule will be rebuilt with this travel time.',
    remove: 'Remove Added Route',
    saved: 'Added Route',
  },
})
const ERRORS = T.errors

// 便の無い電車・バスの区間の画面。先頭に Google マップの経路、その下に、乗換のスクリーンショットで実際の時刻に合わせる手順（任意）。
// 暗幕を置かずに開き、上の地図でその区間を見られるようにする（読み取ったら高さいっぱいに広げる）
export function TransitSheet({ fromName, toName, leg, noTable, onSave, onRemove, onMode, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [route, setRoute] = useState<TransitRoute | null>(null)
  // 写真を選ぶ画面を「キャンセル」で閉じたときも、地図に描き直してもらう
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = fileRef.current
    el?.addEventListener('cancel', askMapRedraw)
    return () => el?.removeEventListener('cancel', askMapRedraw)
  }, [])

  const pick = async (file: File | undefined) => {
    askMapRedraw()
    if (!file) return
    setError('')
    setRoute(null)
    setBusy(true)
    try {
      const image = await shrink(file)
      const r = await loggedFetch('/api/transit-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, from: fromName, to: toName, lang }),
      })
      const j = (await r.json()) as { route?: TransitRoute; error?: string }
      if (j.route) setRoute(j.route)
      else setError(ERRORS[j.error ?? 'failed'] ?? ERRORS.failed)
    } catch {
      setError(ERRORS.failed)
    } finally {
      setBusy(false)
    }
  }

  // スクリーンショットから入れてある経路（時刻表から選んだ便は便の画面で出す）
  const saved = leg.real && !leg.real.bus && !route ? leg.real : null
  return (
    <Sheet title={T.title} lead={`${fromName} → ${toName}`} onClose={onClose} card grow={!!route || !!error || !!saved}>
      {noTable && <p className="transit-none">{T.noTable}</p>}
      {saved && (
        <section className="sheet-sec first" aria-labelledby="transit-saved-title">
          <h3 id="transit-saved-title" className="sec-title">
            {T.saved}
          </h3>
          <TransitSteps route={saved} />
        </section>
      )}
      <MapsLink className="btn-line wide transit-maps" web={mapsDirUrl(leg)} app={mapsAppDirUrl(leg)}>
        {T.maps}
      </MapsLink>
      <section className="transit-shot" aria-labelledby="transit-shot-title">
        <Heading level={3} id="transit-shot-title" className="sec-title">
          {T.shot}
        </Heading>
        <p className="howto-why">{T.why}</p>
        <ol className="steps-howto">
          <li>
            <span className="howto-no num">1</span>
            <div>
              <p>{T.step1}</p>
            </div>
          </li>
          <li>
            <span className="howto-no num">2</span>
            <div>
              <p>{T.step2}</p>
              <label className="btn-line file" aria-disabled={busy}>
                {busy ? T.reading : T.choose}
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => {
                    pick(e.target.files?.[0])
                    e.target.value = ''
                  }} ref={fileRef} />
              </label>
            </div>
          </li>
        </ol>
      </section>

      <div aria-live="polite">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {route && (
          <section className="sheet-sec">
            <Heading level={3} className="sec-title">
              {T.found}
              {route.origin && route.destination ? `: ${route.origin} → ${route.destination}` : ''}
            </Heading>
            <TransitSteps route={route} />
            <Button variant="primary" size="lg" width="100%" label={T.add} onClick={() => onSave(route)} />
            <p className="note">{T.rebuild}</p>
          </section>
        )}
      </div>

      {leg.real && !route && (
        <div className="sheet-actions">
          <Button variant="secondary" size="lg" width="100%" label={T.remove} onClick={onRemove} />
        </div>
      )}
      {!route && <LegModeChoice leg={leg} onMode={onMode} />}
    </Sheet>
  )
}
