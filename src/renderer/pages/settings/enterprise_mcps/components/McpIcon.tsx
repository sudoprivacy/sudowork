/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Cable } from 'lucide-react';
import { ConfigStorage } from '@/common/storage';

interface McpIconProps {
  icon: string | null | undefined;
  size?: number;
  className?: string;
}

/** Allow `data:` and `http(s):` URLs straight through; relative paths resolved via baseUrl. */
function resolveIconUrl(icon: string | null | undefined, baseUrl?: string): string | null {
  if (!icon) return null;
  if (icon.startsWith('data:') || icon.startsWith('http://') || icon.startsWith('https://')) return icon;
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}${icon.startsWith('/') ? icon : `/${icon}`}`;
  }
  return null;
}

const McpIcon: React.FC<McpIconProps> = ({ icon, size = 36, className = '' }) => {
  const [errored, setErrored] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
        if (mounted && typeof serverUrl === 'string') {
          setBaseUrl(serverUrl);
        }
      } catch {
        // silent
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const url = resolveIconUrl(icon, baseUrl);
  const showImage = url && !errored;

  return (
    <div className={`rounded-8px bg-fill-2 f-center flex-shrink-0 overflow-hidden ${className}`} style={{ width: size, height: size }}>
      {showImage ? <img src={url} alt='' className='w-full h-full object-contain' onError={() => setErrored(true)} /> : <Cable size={Math.floor(size * 0.5)} className='text-tertiary' />}
    </div>
  );
};

export default McpIcon;
