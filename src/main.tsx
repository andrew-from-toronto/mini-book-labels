import { StrictMode } from 'react';
import { captureSource } from './lib/attribution';
import { trackErrors, trackVisit } from './lib/telemetry';
import { watchForUpdates } from './lib/updates';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

captureSource(location.search);
trackErrors();
trackVisit();

watchForUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
