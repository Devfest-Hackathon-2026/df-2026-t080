// Google マップの下地の見た目（明るい画面用・暗い画面用）。
// 地図の上で目立つのはプランの線と札だけにする: 店や名所の印、駅の印、道路の名前と番号は出さない。
// 位置の手がかりになる川・公園・線路だけを、色を抜いて薄く残す（市や区の名前も、札の名前とまぎらわしいので出さない）
type Rule = google.maps.MapTypeStyle

type Tone = {
  land: string
  built: string
  park: string
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
  park: '#e0e9df',
  water: '#d2dfe8',
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
  park: '#15221e',
  water: '#0c1b26',
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
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: t.park }] },
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
