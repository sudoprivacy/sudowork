/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useInit } from '../context/InitContext';

const InitLoading: React.FC = () => {
  const { status } = useInit();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: 'var(--bg-1, #1a1a1a)',
        color: 'var(--text-1, #ffffff)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: '3px solid var(--color-border-2, #333)',
          borderTopColor: 'var(--primary, #4a9eff)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: 16,
        }}
      />
      <div style={{ fontSize: 16, opacity: 0.9 }}>{status.message}</div>
      {status.error && <div style={{ fontSize: 14, color: 'var(--color-error, #ff6b6b)', marginTop: 8 }}>{status.error}</div>}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default InitLoading;
