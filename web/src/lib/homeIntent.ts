// ホーム画面から旅を開くときの頼み（開いたあとに App を作り直すので、作り直した App が読む）。
// StrictMode で初めの値を 2 回求めても同じになるよう、読むだけでは消さず、振り返りを閉じたら消す
let recap = false

// 次に開く旅で、振り返りカードを開く
export function askRecapOnOpen() {
  recap = true
}
export const recapOnOpen = () => recap
export function clearRecapOnOpen() {
  recap = false
}

// 例のプラン（例のエリアを、場所を選ばずに組んだプラン）を作る頼み。選ぶ画面が例のエリアを読んだら、すぐに組む
let example = false
export function askExample() {
  example = true
}
export const exampleAsked = () => example
export function takeExample(): boolean {
  const v = example
  example = false
  return v
}

// 言語を変えて読み直したあとに開く物。'plan' は端末のプラン、'form' は空の入力の画面、ほかは開くクラウドの旅の id。
// ページを読み直すので、このタブの sessionStorage に置き、読み直したあとで 1 回だけ読む
const AFTER = 'intentrip:open-after-lang'
export function askOpenAfterLang(what: 'plan' | 'form' | string) {
  try {
    window.sessionStorage.setItem(AFTER, what)
  } catch {
    // 置けなければ、読み直したあとはホーム画面から始まる
  }
}
let after: string | null | undefined
export function openAfterLang(): string | null {
  if (after === undefined) {
    try {
      after = window.sessionStorage.getItem(AFTER)
      window.sessionStorage.removeItem(AFTER)
    } catch {
      after = null
    }
  }
  return after
}
