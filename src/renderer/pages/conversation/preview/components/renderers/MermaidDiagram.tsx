/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type MermaidRenderState = { status: 'loading' } | { status: 'success'; svg: string } | { status: 'error'; message: string };

interface MermaidDiagramProps {
  code: string;
  theme: 'light' | 'dark';
}

const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code, theme }) => {
  const { t } = useTranslation();
  const id = useId();
  const [state, setState] = useState<MermaidRenderState>({ status: 'loading' });

  // Generate a stable render ID based on component ID
  const renderId = useMemo(() => `mermaid-${id.replace(/:/g, '-')}`, [id]);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      try {
        // Dynamic import to reduce initial bundle size
        const mermaid = await import('mermaid');

        // Configure mermaid
        mermaid.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          flowchart: {
            useMaxWidth: false,
          },
          sequence: {
            useMaxWidth: false,
          },
          gantt: {
            useMaxWidth: false,
          },
        });

        // Render the diagram
        const { svg } = await mermaid.default.render(renderId, code);

        if (!cancelled) {
          setState({ status: 'success', svg });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          setState({ status: 'error', message });
        }
      }
    };

    setState({ status: 'loading' });
    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, theme, renderId]);

  // Base container styles
  const containerStyle: React.CSSProperties = {
    maxWidth: '100%',
    overflow: 'auto',
    border: '1px solid var(--border-default)',
    borderRadius: '8px',
    background: 'var(--color-bg-1)',
    padding: '16px',
  };

  if (state.status === 'loading') {
    return (
      <div style={containerStyle} className='flex items-center justify-center min-h-[100px]'>
        <div className='animate-spin w-6 h-6 border-[2px] border-primary border-t-transparent rounded-full' />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div style={containerStyle}>
        <div className='flex items-center gap-8px text-red-500 mb-8px'>
          <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
            <circle cx='12' cy='12' r='10' />
            <line x1='12' y1='8' x2='12' y2='12' />
            <line x1='12' y1='16' x2='12.01' y2='16' />
          </svg>
          <span className='font-medium'>{t('preview.mermaidError', 'Mermaid diagram render failed')}</span>
        </div>
        <div className='text-12px text-secondary mb-12px'>{state.message}</div>
        <details className='cursor-pointer'>
          <summary className='text-12px text-secondary hover:text-foreground'>{t('preview.viewSource', 'View source')}</summary>
          <pre className='mt-8px p-12px rounded-4px overflow-auto text-12px'>
            <code>{code}</code>
          </pre>
        </details>
      </div>
    );
  }

  return <div style={containerStyle} dangerouslySetInnerHTML={{ __html: state.svg }} />;
};

export default MermaidDiagram;
