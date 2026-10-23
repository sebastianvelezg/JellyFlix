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
initLanguage()
applyAppearance()
startVisit()
registerServiceWorker()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
