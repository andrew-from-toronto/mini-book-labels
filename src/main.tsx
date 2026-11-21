import { StrictMode } from 'react';
import { captureSource } from './lib/attribution';
import { trackErrors } from './lib/telemetry';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

captureSource(location.search);
trackErrors();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
