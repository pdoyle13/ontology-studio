import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// dev-only: expose the store + layout engine for automated measurement
if (import.meta.env.DEV) {
  Promise.all([import('./state/canvas'), import('./layout')]).then(([c, l]) => {
    (window as unknown as Record<string, unknown>).__studio = {
      canvas: c.useCanvas,
      engine: l,
    };
  });
}
