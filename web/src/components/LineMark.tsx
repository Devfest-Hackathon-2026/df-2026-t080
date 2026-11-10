// 路線の色の小さな印。路線名の頭に付け、地図の乗る区間と同じ色にする（字の色は本文のまま）
export function LineMark({ color }: { color: string | null }) {
  if (!color) return null
  return <span className="line-mark" style={{ background: color }} aria-hidden="true" />
}
