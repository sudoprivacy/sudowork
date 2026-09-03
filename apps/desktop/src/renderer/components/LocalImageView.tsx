/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Image } from '@arco-design/web-react';
import { LoadingTwo } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { joinPath } from '@sudowork/common/chatLib';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { createContext } from '../utils/createContext';

const [useLocalImage, LocalImageProvider, useUpdateLocalImage] = createContext({ root: '' });

const LocalImageView: React.FC<{
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}> & {
  Provider: typeof LocalImageProvider;
  useUpdateLocalImage: typeof useUpdateLocalImage;
} = ({ src, alt, className, style }) => {
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState(src);
  const { root } = useLocalImage();

  const absolutePath = useMemo(() => {
    if (!root) return src;
    // Strip Windows extended-length path prefix \\?\ if present
    const cleanSrc = src.replace(/^\\\\\?\\/, '');
    if (cleanSrc.startsWith('http') || cleanSrc.startsWith('data:') || cleanSrc.startsWith('/') || cleanSrc.startsWith('file:') || cleanSrc.startsWith('\\') || /^[A-Za-z]:/.test(cleanSrc)) {
      return cleanSrc;
    }
    return joinPath(root, cleanSrc);
  }, [src, root]);

  // Initialize loading state and update when absolutePath changes
  useEffect(() => {
    setLoading(true);
  }, [absolutePath]);

  useEffect(() => {
    ipcBridge.fs.getImageBase64
      .invoke({ path: absolutePath })
      .then((base64) => {
        setUrl(base64);
        setLoading(false);
      })
      .catch((error) => {
        console.error('[LocalImageView] Failed to load image:', {
          path: absolutePath,
          error,
        });
        setLoading(false);
      });
  }, [absolutePath]);

  if (loading)
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <LoadingTwo className='loading' style={{ display: 'flex' }} theme='outline' size='14' fill={'var(--foreground)'} strokeWidth={2} />
        <span>{alt}</span>
      </span>
    );

  return <Image src={url} alt={alt} className={className} style={{ ...style, cursor: 'pointer' }} preview />;
};

LocalImageView.Provider = LocalImageProvider;
LocalImageView.useUpdateLocalImage = useUpdateLocalImage;

export default LocalImageView;
