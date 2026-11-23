// 希望の文や、泊まりの旅を作るときの 1 行の文に、車で回ることが書いてあるか

// 「電車で」「自転車で」「人力車で」などの「車で」は数えない
const CAR_JA = /レンタカー|ドライブ|マイカー|自家用車|カーシェア|(?<![電転力覧列馬停駐洗輪人台下乗発配降汽客貨])車(で|を借り|を使|移動|の旅)/
const NO_CAR_JA = /(車|レンタカー)(は|を)?(使わ|借りな|なし|無し)|運転(しない|しません|できない|できません|せず)|免許(が|は)?(ない|無い|ありません)/
const CAR_EN = /\b(by car|rental car|rent(ing)? a car|car rental|road ?trip|drive|driving)\b/i
const NO_CAR_EN = /\b(no car|without a car|(don'?t|do not|won'?t|can'?t|cannot) drive|not driving)\b/i

// true: 車で回ると書いてある、false: 車を使わないと書いてある、null: どちらも書いていない
export function mentionsCar(text: string): boolean | null {
  const t = text.normalize('NFKC')
  if (NO_CAR_JA.test(t) || NO_CAR_EN.test(t)) return false
  if (CAR_JA.test(t) || CAR_EN.test(t)) return true
  return null
}
