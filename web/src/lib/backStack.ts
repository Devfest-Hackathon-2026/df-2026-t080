import { useEffect, useRef } from 'react'

// 開いているシートやメニューを、ブラウザの履歴に 1 つずつ積む。
// スマホの「戻る」（popstate）では、いちばん上の 1 つだけを閉じる。
// 「閉じる」・背景・下へ払うなど、ほかの閉じ方で閉じたときは、積んだ履歴を戻して取り除く。
// 開け閉めは次の描き直しのあとにまとめて合わせるので、シートからシートへ替わったときは、履歴は増えも減りもしない。
// 積む履歴の URL は今のまま。state に、このページの印と、何段目かを付ける
//
// 画面（ホーム・選ぶ・入力・プラン）も、来た順に履歴に積む。シートの段は、その画面の段の上に積む。
// 画面の段の state には、そこまでに来た画面の並びを付ける（読み直しや App の作り直しのあとも、どこから来たかが分かる）。
// 「戻る」で前の画面の段に来たら、App に渡した関数で、その画面へ戻る（画面の中の「戻る」と同じ処理）。
// 「進む」で先の段に来たときは、戻して今の画面のままにする

type Layer = { close: () => void; closing: boolean; returns: boolean }

const KEY = 'intentripLayer'
const SCREEN = 'intentripScreen'
const page = Math.random().toString(36).slice(2)
const layers: Layer[] = []
// 自分で戻した履歴の popstate を待っている間（来なかったときのために、待つのは 1 秒まで）
let going = false
let guard = 0
let timer = 0
// 今の画面までの並び（App が画面を知らせるまでは null）と、前の画面へ戻る関数（戻った先の画面を返す）
let screens: string[] | null = null
let screenBack: ((to: string[]) => string) | null = null

function levelOf(state: unknown): number {
  if (!state || typeof state !== 'object') return 0
  const m = (state as Record<string, unknown>)[KEY]
  if (!m || typeof m !== 'object') return 0
  const { page: p, n } = m as { page?: unknown; n?: unknown }
  return p === page && typeof n === 'number' && n > 0 ? n : 0
}

function screensOf(state: unknown): string[] | null {
  if (!state || typeof state !== 'object') return null
  const m = (state as Record<string, unknown>)[SCREEN]
  if (!Array.isArray(m) || !m.length || m.length > 50 || !m.every((v) => typeof v === 'string')) return null
  return m as string[]
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

function base(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== 'object') return {}
  const { [KEY]: _layer, ...rest } = state as Record<string, unknown>
  return rest
}

function back(steps: number) {
  going = true
  guard = window.setTimeout(() => {
    going = false
    later()
  }, 1000)
  try {
    window.history.go(-steps)
  } catch {
    going = false
    window.clearTimeout(guard)
  }
}

// 画面の段を、今の画面の並びに合わせる。履歴を戻しに行ったときは true（popstate のあとで、もう一度合わせる）
function syncScreens(n: number): boolean {
  if (!screens) return false
  const state = window.history.state
  const now = screensOf(state)
  if (!now) {
    window.history.replaceState({ ...(state && typeof state === 'object' ? state : {}), [SCREEN]: screens.slice(0, 1) }, '')
    if (screens.length === 1) return false
    return syncScreens(n)
  }
  const have = now.length
  const want = screens.length
  if (have > want) {
    back(n + have - want)
    return true
  }
  if (have < want) {
    if (n > 0) {
      back(n)
      return true
    }
    try {
      for (let i = have + 1; i <= want; i++) window.history.pushState({ ...base(window.history.state), [SCREEN]: screens.slice(0, i) }, '')
    } catch {
      /* 積めなかった分は、画面の中の「戻る」で戻る */
    }
    return false
  }
  if (!same(now, screens)) window.history.replaceState({ ...(state as Record<string, unknown>), [SCREEN]: screens.slice() }, '')
  return false
}

function push(want: number) {
  let n = levelOf(window.history.state)
  if (n >= want) return
  // 履歴を行き来したときに、ブラウザがページの位置を勝手に戻さないようにする（シートを閉じるときに自分で戻す）
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  try {
    while (n < want) {
      n += 1
      const s = window.history.state
      window.history.pushState({ ...(s && typeof s === 'object' ? s : {}), [KEY]: { page, n } }, '')
    }
  } catch {
    /* 短い間に積みすぎて断られたときは、積めた分だけにする（閉じるのボタンでは閉じられる） */
  }
}

function sync() {
  timer = 0
  if (going) return
  for (const l of layers) l.closing = false
  const want = layers.length
  if (syncScreens(levelOf(window.history.state))) return
  const n = levelOf(window.history.state)
  if (want > n) push(want)
  else if (want < n) back(n - want)
}

function later() {
  if (!timer) timer = window.setTimeout(sync, 0)
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const to = screens && screensOf(e.state)
    if (going) {
      going = false
      window.clearTimeout(guard)
    } else if (screens && to && to.length < screens.length) {
      // 前の画面の段に戻った: 開いているシートを閉じ、その画面へ戻る
      for (const l of layers.filter((l) => !l.closing).reverse()) {
        l.closing = true
        l.close()
      }
      screens = to.slice()
      showScreen(screenBack ? screenBack(to.slice()) : to[to.length - 1], true)
    } else if (screens && to && to.length > screens.length) {
      // 進むで先の画面の段に来た: 合わせるときに戻す
    } else {
      const open = layers.filter((l) => !l.closing)
      const n = levelOf(e.state)
      const shut = open.slice(n)
      for (const l of [...shut].reverse()) {
        l.closing = true
        l.close()
      }
      // 前のシートへ戻るシートを閉じたときは、戻った先のシートの分を、すぐに積み直す（続けて「戻る」を押されても、アプリから出ない）
      if (shut[0]?.returns) push(n + 1)
    }
    later()
  })
}

// on の間、「戻る」で close を呼ぶ。閉じたら（on が false になるか、外れたら）積んだ履歴を取り除く。
// returns: 閉じると、前のシートに戻る（閉じても、開いている数が減らない）
export function useBackClose(on: boolean, close: () => void, returns = false) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!on) return
    const layer: Layer = { close: () => ref.current(), closing: false, returns }
    layers.push(layer)
    later()
    return () => {
      const i = layers.indexOf(layer)
      if (i >= 0) layers.splice(i, 1)
      later()
    }
  }, [on, returns])
}

// 今の画面を知らせる。同じ画面なら何もしない。ホームは一番下の段にする（ホームで「戻る」はアプリの外へ）。
// プランが前の段にあればそこまで戻し、前の段の選ぶ画面に替わったら 1 段戻す。それ以外は 1 段積む（戻るの返事で替わったときは、積まずに置き換える）
function showScreen(view: string, replace = false) {
  if (!screens) {
    const had = screensOf(window.history.state)
    screens = had ? had.slice() : [view]
  }
  const top = screens.length - 1
  if (screens[top] === view) {
    // そのまま
  } else if (view === 'home') screens = ['home']
  else if (view === 'plan' && screens.lastIndexOf('plan') >= 0) screens = screens.slice(0, screens.lastIndexOf('plan') + 1)
  else if (view === 'pick' && top > 0 && screens[top - 1] === view) screens = screens.slice(0, top)
  else if (replace) screens[top] = view
  else screens.push(view)
  later()
}

// 今の画面（null は履歴に入れない一瞬の画面）を知らせ、「戻る」で前の画面の段に来たときの戻り方を渡す。
// back(to): to は戻った段までの画面の並び（最後が戻った段の画面）。戻した先の画面を返す
export function useScreenBack(view: string | null, back: (to: string[]) => string) {
  const ref = useRef(back)
  ref.current = back
  useEffect(() => {
    screenBack = (to) => ref.current(to)
  }, [])
  useEffect(() => {
    if (view) showScreen(view)
  }, [view])
}

// ホーム画面を通らずに開いたときに、今の段の下にホーム画面の段を置く（「戻る」でホーム画面へ）
export function homeBelow() {
  if (screens) return
  const s = window.history.state
  if (screensOf(s)) return
  window.history.replaceState({ ...(s && typeof s === 'object' ? s : {}), [SCREEN]: ['home'] }, '')
}
