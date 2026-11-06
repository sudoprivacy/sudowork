import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { Button, Input } from '@arco-design/web-react';
import { initReactI18next } from 'react-i18next';
import '@arco-design/web-react/dist/css/arco.css';
import 'virtual:uno.css';
import '../../../../../packages/renderer/src/styles/index.css';
import '../../../../../packages/renderer/src/styles/arco-override.scss';
import ConversationChatConfirm from '../../../../../packages/renderer/src/pages/conversation/components/ConversationChatConfirm';
import LoginApprovalModal from '../../../../../packages/renderer/src/components/PwdLoginApprovalModal';
import { requestApproval } from './bridge';

function Acceptance() {
  const [isLoginVisible, setIsLoginVisible] = useState(false);
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '32px', background: 'var(--bg-subtle)' }}>
      <h1>Shared approval theme acceptance</h1>
      <nav style={{ display: 'flex', gap: '12px', margin: '24px 0' }}>
        {['light', 'dark'].map((theme) => (
          <Button
            key={theme}
            onClick={() => {
              document.documentElement.dataset.theme = theme;
              document.body.setAttribute('arco-theme', theme);
            }}
          >
            {theme}
          </Button>
        ))}
        <Button onClick={requestApproval}>Request approval</Button>
        <Button onClick={() => setIsLoginVisible(true)}>Request saved login</Button>
      </nav>
      <ConversationChatConfirm conversation_id='theme-acceptance'>
        <Input aria-label='Draft' defaultValue='Keep this draft' />
      </ConversationChatConfirm>
      <LoginApprovalModal
        visible={isLoginVisible}
        title='GitHub'
        onDecide={(decision) => {
          document.body.dataset.decision = decision;
          setIsLoginVisible(false);
        }}
      />
    </main>
  );
}

window.addEventListener('approval-decided', (event) => {
  document.body.dataset.decision = (event as CustomEvent<string>).detail;
});
document.documentElement.dataset.theme = 'dark';
document.body.setAttribute('arco-theme', 'dark');
void createInstance()
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  .then(() => createRoot(document.getElementById('root')!).render(<Acceptance />));
