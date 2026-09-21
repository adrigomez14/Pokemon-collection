import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import './wishlists.css'
import './mobile.css'
import App from './App.tsx'
import { initializePwa } from './lib/pwa'
import { PwaBoundary } from './components/PwaControls'

initializePwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaBoundary><App /></PwaBoundary>
  </StrictMode>,
)
