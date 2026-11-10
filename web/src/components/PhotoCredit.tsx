import type { Spot } from '../types'
import { licenseLabel, licenseLink, sourceLabel, wikiPhoto } from '../lib/photo'
import { tr } from '../lib/i18n'

const T = tr({
  ja: { sep: '・', open: '（', close: '）', photos: '写真の出典' },
  en: { sep: ' · ', open: ' (', close: ')', photos: 'Photo Credits' },
})

type Credited = NonNullable<ReturnType<typeof wikiPhoto>>

// Wikipedia の写真の作者・ライセンス（ライセンスの文へのリンク）・ファイルの説明のページ（bare のときは説明のページを付けない）
export function WikiCredit({ photo, bare = false }: { photo: Credited; bare?: boolean }) {
  const label = licenseLabel(photo.license)
  return (
    <>
      {photo.author && `${photo.author}${T.sep}`}
      {photo.licenseUrl ? (
        <a href={licenseLink(photo.licenseUrl)} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
      {!bare && (
        <>
          {T.open}
          <a href={photo.source} target="_blank" rel="noreferrer">
            {sourceLabel(photo.source)}
          </a>
          {T.close}
        </>
      )}
    </>
  )
}

// 一覧の小さな写真の作者とライセンス（一覧の下に、押すと開く形でまとめる。場所の名前はファイルの説明のページへ）
export function PhotoCredits({ spots }: { spots: Spot[] }) {
  const items = spots.flatMap((s) => {
    const w = wikiPhoto(s)
    return w ? [{ id: s.id, name: s.name, photo: w }] : []
  })
  if (!items.length) return null
  return (
    <details className="photo-credits">
      <summary>{T.photos}</summary>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <a href={it.photo.source} target="_blank" rel="noreferrer">
              {it.name}
            </a>
            : <WikiCredit photo={it.photo} bare />
          </li>
        ))}
      </ul>
    </details>
  )
}
