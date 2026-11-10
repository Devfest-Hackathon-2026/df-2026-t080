// 地図の徒歩の線の形。浅葱の丸い点を、地図の地の色で縁取って、詰めて並べる（Google マップの徒歩の線に近い形）。
// 単位は画面の px。MapLibre 版・Google マップ版・共有の画像で同じ値を使い、同じ大きさと間に見せる
export const WALK_DOT = 7 // 点の直径
export const WALK_EDGE = 1.25 // 縁の太さ
export const WALK_STEP = 12 // 点の中心から次の点の中心まで
export const WALK_BACK = 0.8 // 最後に出発地へ戻る区間は、点・縁・間を全部この割合で小さくする

type XY = { x: number; y: number }

// 画面の上の線に沿って、始めから step ごとに点を置く
export function along(pts: XY[], step: number): XY[] {
  const out: XY[] = []
  let next = 0
  let run = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    for (; next <= run + len; next += step) {
      const t = len ? (next - run) / len : 0
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
    run += len
  }
  return out
}
