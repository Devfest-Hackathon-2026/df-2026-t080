import { isEn, tr } from './i18n'
import type { Spot, WikiPhoto } from '../types'
import type { PlaceInfo, PlacePhoto } from './place'

// Wikipedia の写真の大きさを変えた URL（決まった幅だけが使える: 120・250・330・500・960 など）
export const thumbUrl = (url: string, w: 120 | 250 | 330 | 500 | 960) => url.replace(/\/\d+px-/, `/${w}px-`)

// 大きな写真（場所の画面の上）の幅の候補と、その表示の幅。画面の幅と細かさに合う小さい方を読ませる
export const HERO_SIZES = '(min-width: 960px) 388px, min(calc(100vw - 40px), 600px)'
export const wikiHeroSet = (url: string) => ([330, 500, 960] as const).map((w) => `${thumbUrl(url, w)} ${w}w`).join(', ')

// 一覧の小さな写真（表示は 56px 四方）。画面の細かさが 1〜2 倍なら 120px、3 倍なら 250px を読む
export const thumbSrcSet = (url: string) => `${thumbUrl(url, 120)} 1x, ${thumbUrl(url, 120)} 2x, ${thumbUrl(url, 250)} 3x`

type CreditedWiki = WikiPhoto & { license: string; source: string }

// 作者とライセンスが分かる写真だけを使う（分からなければ種類のアイコンに戻る）
export const wikiPhoto = (s: Spot): CreditedWiki | null => (s.photo?.license && s.photo.source ? (s.photo as CreditedWiki) : null)

// Google の写真を使う場所。記事の写真が無い場所だけで、通り・商店街は使わない
// （その場所に投稿された写真に、近くの別の場所が写っていることが多い）
export const usesGooglePhoto = (s: Spot) => !wikiPhoto(s) && s.kind !== 'street'

export type SpotPhoto = { from: 'wiki'; photo: CreditedWiki } | { from: 'google'; photo: PlacePhoto }

// 場所の写真を 1 枚に決める。一覧の小さな写真も、場所の画面と候補の画面の大きな写真も、この 1 枚を使う。
// 1. Wikipedia の記事の写真（記事の題と位置で場所に合わせたもの）
// 2. 記事の写真が無いときは、Google の写真の 1 枚目（info は Google マップを出しているときだけ届く）
// 読み込めなかった写真（failed。Wikipedia の写真は URL、Google の写真は名前）は使わない。
// どちらも無ければ null（一覧は種類のアイコンにし、大きな写真は出さない）
export function spotPhoto(s: Spot, info: PlaceInfo | null | undefined, failed = ''): SpotPhoto | null {
  const w = wikiPhoto(s)
  if (w) return w.url === failed ? null : { from: 'wiki', photo: w }
  const g = usesGooglePhoto(s) ? info?.photos[0] : undefined
  return g && g.name !== failed ? { from: 'google', photo: g } : null
}

export const licenseLabel = (license: string) => (license === 'Public domain' ? tr({ ja: 'パブリックドメイン', en: 'Public domain' }) : license)

export const sourceLabel = (source: string) => (/^https:\/\/commons\.wikimedia\.org\//.test(source) ? 'Wikimedia Commons' : 'Wikipedia')

// クリエイティブ・コモンズのライセンスの URL を https にし、画面の言語の説明のページ（deed.ja・deed.en）にする。ほかの URL はそのまま
export function licenseLink(url: string): string {
  const m = url.trim().match(/^https?:\/\/creativecommons\.org\/((?:licenses|publicdomain)\/[a-z-]+\/\d+(?:\.\d+)*(?:\/[a-z]{2})?)\/?(?:deed\.[A-Za-z_-]+)?\/?$/)
  return m ? `https://creativecommons.org/${m[1]}/deed.${isEn ? 'en' : 'ja'}` : url
}
