import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './runtime/videoGenerationRetry'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
