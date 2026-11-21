import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelDownloadPage } from './components/ModelDownloadPage';
import { watchForUpdates } from './lib/updates';
import { preloadManifold } from './lib/bookModel';
import { preloadAll } from './lib/preload';
import './styles.css';

watchForUpdates();
preloadAll([preloadManifold]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModelDownloadPage />
  </StrictMode>,
);
