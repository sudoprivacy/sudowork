/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useInit } from '../context/InitContext';

const InitLoading: React.FC = () => {
  const { status } = useInit();
  const progress = status.progress ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#1a1a1a',
        color: '#ffffff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ fontSize: 18, marginBottom: 24, opacity: 0.9 }}>{status.message}</div>

      {/* Progress bar container */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 200,
            height: 4,
            backgroundColor: '#333',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {/* Progress bar fill */}
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: '#4a9eff',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <span style={{ fontSize: 14, color: '#888', minWidth: 40 }}>{progress}%</span>
      </div>

      {status.error && <div style={{ fontSize: 14, color: '#ff6b6b', marginTop: 16 }}>{status.error}</div>}
    </div>
  );
};

export default InitLoading;
