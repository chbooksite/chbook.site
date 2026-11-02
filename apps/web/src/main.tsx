import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { readLargeText } from './lib/preferences'

// Antes de pintar, para no ver un salto de tamaño.
document.documentElement.classList.toggle('letra-grande', readLargeText())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
