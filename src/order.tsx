import { StrictMode } from 'react';
import { captureSource } from './lib/attribution';
import { createRoot } from 'react-dom/client';
import { OrderPage } from './components/OrderPage';
import './styles.css';

captureSource(location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OrderPage />
  </StrictMode>,
);
