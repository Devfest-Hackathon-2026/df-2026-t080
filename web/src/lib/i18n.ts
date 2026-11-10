// 画面の言語（日本語・英語）。ページを開いたときに 1 つに決まり、切り替えるとページを読み直す
// （Google マップの読み込みの言語と、サーバーに頼む文の言語も一緒に変わるため）。
// 決め方: URL の ?lang= → このブラウザに残した言語 → ブラウザの言語（並びの中で先に出る日本語か英語。どちらも無ければ英語）。
// index.html の head でも、同じ順で html の lang を先に決めている（決め方を変えるときは両方を変える）。
// 裏の計算（Worker）には、Worker の名前で言語を渡す（usePlan）。
//
// 言葉は部品ごとに tr({ ja: {...}, en: {...} }) で持つ。en は ja と同じ形でないと型の確かめで止まる（鍵の抜け・余り）
export type Lang = 'ja' | 'en'

const STORE = 'intentrip:lang'
const isLang = (v: unknown): v is Lang => v === 'ja' || v === 'en'

export function pickLang(langs: readonly string[]): Lang {
  for (const l of langs) {
    const x = l.toLowerCase()
    if (x === 'ja' || x.startsWith('ja-')) return 'ja'
    if (x === 'en' || x.startsWith('en-')) return 'en'
  }
  return langs.length ? 'en' : 'ja'
}

function detect(): Lang {
  if (typeof window === 'undefined') {
    const name = (globalThis as { name?: unknown }).name
    return isLang(name) ? name : 'ja'
  }
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (isLang(q)) return q
  } catch {
    /* URL を読めないときは次へ */
  }
  try {
    const v = window.localStorage.getItem(STORE)
    if (isLang(v)) return v
  } catch {
    /* 取っておけないブラウザでは、ブラウザの言語で決める */
  }
  const nav = window.navigator
  return pickLang(nav.languages?.length ? nav.languages : nav.language ? [nav.language] : [])
}

export const lang: Lang = detect()
export const isEn = lang === 'en'

// 言語を変えて読み直す。このブラウザに残せないときと、URL で言語を決めていたときは、URL の ?lang= で渡す
export function setLang(next: Lang) {
  if (next === lang) return
  let kept = false
  try {
    window.localStorage.setItem(STORE, next)
    kept = window.localStorage.getItem(STORE) === next
  } catch {
    kept = false
  }
  const url = new URL(window.location.href)
  if (!kept || url.searchParams.has('lang')) {
    url.searchParams.set('lang', next)
    // 履歴の state（来た画面の並び）を残したまま読み直す
    try {
      window.history.replaceState(window.history.state, '', url.toString())
    } catch {
      window.location.replace(url.toString())
      return
    }
  }
  window.location.reload()
}

// 「戻る」で言語を変える前の履歴に来たら、URL の ?lang= を今の言語に合わせる（そのあと読み直しても、言語が戻らないように）
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const url = new URL(window.location.href)
    const q = url.searchParams.get('lang')
    if (q === null || q === lang) return
    url.searchParams.set('lang', lang)
    window.history.replaceState(window.history.state, '', url.toString())
  })
}

export function tr<T>(m: { ja: T; en: NoInfer<T> }): T {
  return isEn ? m.en : m.ja
}

// 言語ごとに分けて取っておく物の名前（英語だけ後ろに :en を付ける。日本語は今までの名前のまま）
export const byLang = (key: string) => (isEn ? `${key}:en` : key)
// その名前の、どちらの言語の置き場も
export const allLangs = (key: string) => [key, `${key}:en`]

// 名前を並べる（日本語は「A・B」、英語は「A and B」「A, B, and C」）
export function joinNames(list: string[]): string {
  if (!isEn) return list.join('・')
  if (list.length <= 2) return list.join(' and ')
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}
