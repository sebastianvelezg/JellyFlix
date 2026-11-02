import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initLanguage } from './components/useLanguage'
import './index.css'
import { setDefaultDeviceName } from './core'
import { applyAppearance } from './platform/web/appearance'
import { startVisit } from './platform/web/lastVisit'
import { describeDevice } from './platform/web/device'
import { registerServiceWorker } from './platform/web/pwa'

// What other devices see in their "Play on…" list: "iPhone (app)", "Windows · Chrome"...
setDefaultDeviceName(describeDevice())
applyAppearance()
startVisit()
registerServiceWorker()

// The first screen is drawn once the texts of the language are here (Spanish is a separate download; English needs none).
void initLanguage().then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
