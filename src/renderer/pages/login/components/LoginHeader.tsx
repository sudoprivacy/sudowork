import React from 'react';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';

export default function LoginHeader({ appName, description, logo }: ILoginHeaderProps) {
  return (
    <header className='mb-7 text-center'>
      <div className='mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-xl bg-secondary shadow-sm'>
        <img src={logo || SudoworkIcon} alt='' className='h-14 w-14 object-contain' />
      </div>
      <h1 className='text-2xl font-700 tracking-tight text-foreground'>{appName}</h1>
      <p className='mt-2 text-sm leading-6 text-foreground-tertiary'>{description}</p>
    </header>
  );
}

interface ILoginHeaderProps {
  appName: string;
  description: string;
  logo?: string;
}
