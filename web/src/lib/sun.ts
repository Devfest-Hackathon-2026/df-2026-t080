// 日の入りの時刻。NOAA（米国海洋大気庁）の太陽の位置の近似式で、日付と緯度・経度から求める（誤差は数分）
const RAD = Math.PI / 180

// iso の日の、その地点の日の入り（日本時間の 0 時からの分）。白夜・極夜で日が沈まない・昇らないときは null
export function sunsetMin(iso: string, lat: number, lng: number): number | null {
  const [y, m, d] = iso.split('-').map(Number)
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000)
  const g = ((2 * Math.PI) / 365) * day
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  const cosHa = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl)
  if (cosHa < -1 || cosHa > 1) return null
  const ha = Math.acos(cosHa) / RAD
  const utc = 720 - 4 * (lng - ha) - eqTime
  return Math.round(utc + 9 * 60)
}
