// Google マップの下地の見た目（明るい画面用・暗い画面用）。
// 地図の上で目立つのはプランの線と札だけにする: 店や名所の印、駅の印、道路の名前と番号は出さない。
// 位置の手がかりになる川・公園・線路だけを残す。水は薄い青、公園・山・寺社の森は薄い緑、道と建物は灰と白（市や区の名前も、札の名前とまぎらわしいので出さない）。
// 水と緑の色は MapLibre 版（components/MapView.tsx）も同じ値を使う
type Rule = google.maps.MapTypeStyle

type Tone = {
  land: string
  built: string
  park: string
  wood: string
  water: string
  road: string
  arterial: string
  highway: string
  highwayEdge: string
  rail: string
  label: string
  labelEdge: string
  border: string
}

const LIGHT: Tone = {
  land: '#eef1f4',
  built: '#e8ecf0',
  park: '#d3e8cf',
  wood: '#dbe9d6',
  water: '#bfd8ea',
  road: '#ffffff',
  arterial: '#ffffff',
  highway: '#ffffff',
  highwayEdge: '#d9dfe6',
  rail: '#cdd4dc',
  label: '#7d8999',
  labelEdge: '#eef1f4',
  border: '#c9d0d8',
}

const DARK: Tone = {
  land: '#141b23',
  built: '#171f28',
  park: '#173022',
  wood: '#162a20',
  water: '#112c40',
  road: '#1e2832',
  arterial: '#243039',
  highway: '#2a3642',
  highwayEdge: '#141b23',
  rail: '#2a3440',
  label: '#a3adba',
  labelEdge: '#141b23',
  border: '#2c3642',
}

function rules(t: Tone): Rule[] {
  return [
    { elementType: 'geometry', stylers: [{ color: t.land }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: t.label }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: t.labelEdge }, { weight: 3 }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.locality', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ visibility: 'on' }, { color: t.border }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: t.built }] },
    { featureType: 'landscape.natural', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'landscape.natural.landcover', elementType: 'geometry', stylers: [{ color: t.wood }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: t.park }] },
    { featureType: 'poi.place_of_worship', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: t.wood }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: t.road }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ visibility: 'off' }] },
    { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: t.arterial }] },
    { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: t.highway }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ visibility: 'on' }, { color: t.highwayEdge }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit.line', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: t.rail }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: t.water }] },
    { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ]
}

export const mapStyle = (dark: boolean): Rule[] => rules(dark ? DARK : LIGHT)
export const mapLand = (dark: boolean) => (dark ? DARK : LIGHT).land
export const mapTint = (dark: boolean) => {
  const t = dark ? DARK : LIGHT
  return { water: t.water, park: t.park, wood: t.wood }
}
