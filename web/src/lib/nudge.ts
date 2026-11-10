// 「この旅は端末にだけ保存」の一言を、閉じた旅（旅を作り始めた時刻 since）の覚え。端末の localStorage にだけ取る
const STORE = 'intentrip:nudge:v1'
const KEEP = 30

function read(): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) || '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
  } catch {
    return []
  }
}

export const isNudgeClosed = (since: number): boolean => read().includes(since)

export function closeNudge(since: number): void {
  try {
    window.localStorage.setItem(STORE, JSON.stringify([...read().filter((x) => x !== since), since].slice(-KEEP)))
  } catch {
    // 書けなくても、この画面では閉じたままにする（呼び出し側の状態で閉じる）
  }
}
