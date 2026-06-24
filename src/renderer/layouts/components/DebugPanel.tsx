/// <reference types="vite/client" />
/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Descriptions, Popover } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

const DebuggerInfo: React.FC = () => {
  const location = useLocation();
  const params = useParams();

  const fullPath = location.pathname + location.search + location.hash;

  const rows: [string, string][] = [
    ['url', fullPath],
    ['params', Object.keys(params).length ? JSON.stringify(params, null, 2) : '—'],
  ];

  return (
    <div className='font-mono'>
      <Descriptions column={1} data={rows.map(([label, value]) => ({ label, value }))} size='small' layout='inline-horizontal' labelStyle={{ width: 64, minWidth: 64 }} />
    </div>
  );
};

const DebugPanel: React.FC = () => {
  const [visible, setVisible] = useState(false);

  if (!import.meta.env.DEV) return null;

  return (
    <div className='fixed bottom-4 right-4 z-9999'>
      <Popover
        position='tr'
        popupVisible={visible}
        className='!w-[420px] !max-w-[420px]'
        triggerProps={{ autoFitPosition: false }}
        content={
          <div>
            <div className='flex items-center justify-between mb-2'>
              <span className='font-sans font-600 text-14px text-1'>Debugger</span>
              <Button size='mini' type='text' onClick={() => setVisible(false)}>
                ✕
              </Button>
            </div>
            <DebuggerInfo />
          </div>
        }
      >
        <Button size='small' type='primary' onClick={() => setVisible((v) => !v)}>
          Debugger
        </Button>
      </Popover>
    </div>
  );
};

export default DebugPanel;
