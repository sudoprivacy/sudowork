import React from 'react';
import brand from '@brand';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';

export default function LoginHeader({ appName, description, logo }: ILoginHeaderProps) {
  const isDescriptionVisible = Boolean((brand as { tagline?: string }).tagline?.trim());

  return (
    <header className='mb-7 text-center'>
      <img src={logo || SudoworkIcon} alt='' className='mx-auto mb-1 h-16 w-16 object-contain' />
      <h1 className='m-0 text-2xl font-700 tracking-tight text-foreground'>{appName}</h1>
      {isDescriptionVisible && description && <p className='mt-2 text-sm leading-6 text-foreground-tertiary'>{description}</p>}
    </header>
  );
}

interface ILoginHeaderProps {
  appName: string;
  description: string;
  logo?: string;
}
