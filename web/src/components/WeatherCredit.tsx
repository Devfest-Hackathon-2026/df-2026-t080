import { tr } from '../lib/i18n'

const T = tr({
  ja: { weather: '天気:', sep: '・', license: 'https://creativecommons.org/licenses/by/4.0/deed.ja' },
  en: { weather: 'Weather:', sep: ' · ', license: 'https://creativecommons.org/licenses/by/4.0/' },
})

// 天気のデータの出典（Open-Meteo の API のデータは CC BY 4.0。表示する所に Open-Meteo へのリンクを添える）
export function WeatherCredit({ className }: { className?: string }) {
  return (
    <p className={className ? `weather-credit ${className}` : 'weather-credit'}>
      {T.weather}{' '}
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        Open-Meteo.com
      </a>
      {T.sep}
      <a href={T.license} target="_blank" rel="noreferrer">
        CC BY 4.0
      </a>
    </p>
  )
}
