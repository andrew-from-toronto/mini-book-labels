import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage } from './components/AdminPage';
import { watchForUpdates } from './lib/updates';
import './styles.css';

watchForUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminPage />
  </StrictMode>,
);
