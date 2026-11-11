import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OrderPage } from './components/OrderPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OrderPage />
  </StrictMode>,
);
