import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import '@arco-design/web-react/dist/css/arco.css';
import 'virtual:uno.css';
import BrowserSessionPanel from '../../../../../packages/renderer/src/components/browser/BrowserSessionPanel';
import conversation from '../../../../../packages/renderer/src/i18n/locales/en-US/conversation.json';

async function start() {
  window.addEventListener('fixture-input-acknowledged', (event) => {
    const input = (event as CustomEvent).detail;
    document.documentElement.dataset.lastInputAcknowledgement = input.kind === 'drag-stream' ? input.phase : input.kind;
  });
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: { conversation } } }, interpolation: { escapeValue: false } });
  document.body.style.margin = '0';
  createRoot(document.getElementById('root')!).render(
    <main style={{ height: '100vh', display: 'flex' }}>
      <BrowserSessionPanel conversationId='page-panel-live' isViewer />
    </main>
  );
}
void start();
