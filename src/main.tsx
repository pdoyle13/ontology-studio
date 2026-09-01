import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Bootstrap first so App.css (the instrument-panel theme bridge) can override it
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import App from './App.tsx';

document.documentElement.setAttribute('data-bs-theme', 'dark');

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

// dev-only: expose the store + layout engine for automated measurement
if (import.meta.env.DEV) {
    Promise.all([import('./state/canvas'), import('./layout')]).then(([c, l]) => {
        (window as unknown as Record<string, unknown>).__studio = {
            canvas: c.useCanvas,
            engine: l,
        };
    });
}
