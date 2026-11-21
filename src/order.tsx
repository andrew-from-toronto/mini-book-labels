import { StrictMode } from 'react';
import { captureSource } from './lib/attribution';
import { watchForUpdates } from './lib/updates';
import { createRoot } from 'react-dom/client';
import { OrderPage } from './components/OrderPage';
import './styles.css';

captureSource(location.search);

watchForUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OrderPage />
  </StrictMode>,
);
