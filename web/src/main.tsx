import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './i18n';
import './styles/base.css';
import './styles/ui.css';
import './styles/overlays.css';
import './styles/pages.css';
import './styles/script.css';
import './styles/studio.css';
import './styles/composition.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
