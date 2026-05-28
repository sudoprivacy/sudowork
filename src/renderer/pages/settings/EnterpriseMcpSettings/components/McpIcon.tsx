import React, { useState } from 'react';
import { Connection } from '@icon-park/react';

interface McpIconProps {
  icon: string | null | undefined;
  size?: number;
  className?: string;
}

/** Allow `data:` and `http(s):` URLs straight through; everything else gets fallback. */
function resolveIconUrl(icon: string | null | undefined): string | null {
  if (!icon) return null;
  if (icon.startsWith('data:') || icon.startsWith('http://') || icon.startsWith('https://')) return icon;
  return null;
}

const McpIcon: React.FC<McpIconProps> = ({ icon, size = 36, className = '' }) => {
  const [errored, setErrored] = useState(false);
  const url = resolveIconUrl(icon);
  const showImage = url && !errored;

  return (
    <div className={`rounded-8px bg-[var(--color-fill-2)] flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`} style={{ width: size, height: size }}>
      {showImage ? <img src={url} alt='' className='w-full h-full object-contain' onError={() => setErrored(true)} /> : <Connection theme='outline' size={Math.floor(size * 0.5)} className='text-t-tertiary' />}
    </div>
  );
};

export default McpIcon;
