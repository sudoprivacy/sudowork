import React, { useState } from 'react';
import { normalizeTenantLogo } from '@sudowork/common/types/tenantConfig';
import defaultLogo from '@renderer/assets/sudowork-icon-dark.svg';

/** One logo loading policy for login, navigation and settings in both hosts. */
export default function TenantLogo({ src, fallback = defaultLogo, ...props }: ITenantLogoProps) {
  const logo = normalizeTenantLogo(src);
  const [failedLogo, setFailedLogo] = useState<string>();
  const imageSrc = logo && logo !== failedLogo ? logo : fallback;

  return <img {...props} src={imageSrc} onError={() => setFailedLogo(logo)} />;
}

interface ITenantLogoProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src?: string;
  fallback?: string;
}
