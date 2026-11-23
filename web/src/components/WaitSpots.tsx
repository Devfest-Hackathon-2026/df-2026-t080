import type { CSSProperties } from 'react'
import type { JobPreview } from '../lib/api'
import { tr } from '../lib/i18n'
import { wikiPhoto } from '../lib/photo'
import { previewSpot, previewTopics } from '../lib/waitSpots'
import { PenguinMark } from './CrowdMark'
import { PhotoCredits } from './PhotoCredit'
import { Thumb } from './Thumb'

const T = tr({
  ja: { sights: (a: string) => `${a}の見どころ`, food: (a: string) => `${a}のお店` },
  en: { sights: (a: string) => `Sights in ${a}`, food: (a: string) => `Food in ${a}` },
})

// 候補を探している間に、行き先の見どころとお店を分けて、名前と特徴で見せる（写真があれば一覧の小さな写真と出典も）
export function WaitSpots({ preview }: { preview: JobPreview }) {
  const topics = previewTopics(preview.places)
  const spots = preview.places.map(previewSpot)
  const photos = spots.some((s) => wikiPhoto(s))
  return (
    <section className="wait-spots" aria-labelledby={`wait-${topics[0]?.topic}`}>
      {topics.map((t, n) => (
        <section key={t.topic} className="wait-group" aria-labelledby={`wait-${t.topic}`}>
          <div className="wait-head">
            {n === 0 && <PenguinMark size={22} />}
            <h2 className="wait-group-title" id={`wait-${t.topic}`}>
              {T[t.topic](preview.area)}
            </h2>
          </div>
          <ul className="wait-list">
            {t.places.map((p, i) => {
              const s = previewSpot(p)
              return (
                <li key={s.id} style={{ '--i': i } as CSSProperties}>
                  {photos && <Thumb spot={s} />}
                  <span className="wait-text">
                    <span className="wait-name">{s.name}</span>
                    {s.why && <span className="wait-why">{s.why}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {photos && <PhotoCredits spots={spots} />}
    </section>
  )
}
