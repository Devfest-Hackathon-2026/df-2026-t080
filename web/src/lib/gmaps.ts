// Google マップ（Maps JavaScript API）の読み込み。キーはビルドのときに VITE_GOOGLE_MAPS_KEY で渡す（リポジトリに入れない）。
// 下地の見た目はコードで決める（lib/mapStyle.ts）ので、マップ ID は使わない。
// キーが無い組み立て（GitHub Pages の公開版など）や、キーが通らなかった・読み込めなかったときは MapLibre の地図を使う
import { lang } from './i18n'

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim() ?? ''
export const hasGoogleMaps = KEY !== ''

type MapsWindow = Window & { __intentripMaps?: () => void; gm_authFailure?: () => void }

let loading: Promise<void> | null = null
const failed = new Set<() => void>()
let unavailable = false

// Google マップが使えないと分かったとき（キーが通らなかった・通信などで読み込めなかった）に呼ばれる。
// 地図を MapLibre に戻し、Places の内容を出さないようにするのに使う
export function onMapsUnavailable(fn: () => void): () => void {
  if (unavailable) fn()
  failed.add(fn)
  return () => failed.delete(fn)
}

export function giveUpGoogleMaps() {
  if (unavailable) return
  unavailable = true
  failed.forEach((fn) => fn())
}

// Google マップの地図が実際に出たか（最初の地図の絵が届いたら true）。キーが通らないときは、読み込みのあとで
// gm_authFailure が呼ばれるので、読み込めただけでは使えると分からない
const working = new Set<() => void>()
let shown = false
export const googleMapsShown = () => shown && !unavailable

export function onMapsShown(fn: () => void): () => void {
  if (shown) fn()
  working.add(fn)
  return () => working.delete(fn)
}

export function markMapsShown() {
  if (shown || unavailable) return
  shown = true
  working.forEach((fn) => fn())
}

export function loadGoogleMaps(): Promise<void> {
  if (!hasGoogleMaps) return Promise.reject(new Error('Google マップのキーがありません'))
  loading ??= new Promise<void>((resolve, reject) => {
    const w = window as MapsWindow
    w.__intentripMaps = () => resolve()
    w.gm_authFailure = giveUpGoogleMaps
    const q = new URLSearchParams({ key: KEY, v: 'quarterly', language: lang, region: 'JP', loading: 'async', callback: '__intentripMaps' })
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?${q}`
    s.async = true
    s.onerror = () => {
      reject(new Error('Google マップを読み込めませんでした'))
      giveUpGoogleMaps()
    }
    document.head.appendChild(s)
  })
  return loading
}
