import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelDownloadPage } from './components/ModelDownloadPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModelDownloadPage />
  </StrictMode>,
);
