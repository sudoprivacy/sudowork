import { Spin } from '@arco-design/web-react';
import React from 'react';

type AppLoaderProps = {
  text?: string;
  subtext?: string;
};

const AppLoader: React.FC<AppLoaderProps> = ({ text, subtext }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
        <Spin dot />
        {text ? <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-1)' }}>{text}</div> : null}
        {subtext ? <div style={{ fontSize: '12px', color: 'var(--color-text-3)', maxWidth: '320px', lineHeight: 1.5 }}>{subtext}</div> : null}
      </div>
    </div>
  );
};

export default AppLoader;
