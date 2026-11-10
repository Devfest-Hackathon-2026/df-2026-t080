import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { Theme } from '@astryxdesign/core/theme'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import jaJP from '@astryxdesign/core/locales/ja-JP.generated.js'
import App from './App'
import { lang } from './lib/i18n'
import { expireSavedLocations } from './lib/saved'
import { onTripOpen } from './lib/trips'
import { themes, defaultThemeSlug } from './astryx-themes'

document.documentElement.lang = lang
if (lang === 'en') document.title = 'IntenTrip | A Day Trip Planned Around the Crowds'
expireSavedLocations()

// クラウドの旅を開いたら、端末に入れたプランから App を作り直す
function Root() {
  const [key, setKey] = useState(0)
  useEffect(() => onTripOpen(() => setKey((k) => k + 1)), [])
  return <App key={key} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InternationalizationProvider locale={lang === 'ja' ? 'ja-JP' : 'en'} messages={{ 'ja-JP': jaJP }}>
      <Theme theme={themes[defaultThemeSlug]}>
        <Root />
      </Theme>
    </InternationalizationProvider>
  </StrictMode>,
)
