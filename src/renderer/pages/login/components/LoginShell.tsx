import React, { type ReactNode } from 'react';
import WindowControls from '@/renderer/components/WindowControls';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';

const isWindowControlsVisible = isElectronDesktop() && !isMacOS();

export default function LoginShell({ children }: ILoginShellProps) {
  return (
    <main className='relative box-border flex min-h-screen items-center justify-center overflow-x-hidden overflow-y-auto bg-background px-4 py-12 text-foreground [-webkit-app-region:drag]'>
      {isWindowControlsVisible && (
        <div className='fixed right-0 top-0 z-50 h-8 [-webkit-app-region:no-drag]'>
          <WindowControls />
        </div>
      )}
      <div aria-hidden='true' className='pointer-events-none fixed inset-0 overflow-hidden'>
        <div className='absolute -right-80px -top-120px h-320px w-320px rounded-full bg-accent opacity-70 blur-64px' />
        <div className='absolute -bottom-120px -left-80px h-320px w-320px rounded-full bg-accent opacity-70 blur-64px' />
      </div>
      {children}
    </main>
  );
}

interface ILoginShellProps {
  children: ReactNode;
}
