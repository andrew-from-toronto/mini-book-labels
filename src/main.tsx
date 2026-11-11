import { StrictMode } from 'react';
import { captureSource } from './lib/attribution';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

captureSource(location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
