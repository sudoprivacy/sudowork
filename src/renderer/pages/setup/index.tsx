import { Button, Input, Message } from '@arco-design/web-react';
import { Building2, Check, Settings2, UserRound } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import brand from '@brand';
import { ipcBridge } from '@/common';
import { setAppMode } from '@/common/eeclawMode';
import { ConfigStorage } from '@/common/storage';
import { normalizeSudoworkServerUrl } from '@/common/sudoworkServer';
import { createTenantConfigCache, TENANT_CONFIG_STORAGE_KEY, resolveTenantConfig } from '@/common/types/tenantConfig';
import WindowControls from '@/renderer/components/WindowControls';
import { useBrandConfig } from '@/renderer/hooks/useBrandConfig';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';

const isWindowControlsVisible = isElectronDesktop() && !isMacOS();
const MODE_CARD_CLASS_NAME = 'relative flex min-h-116px cursor-pointer items-center gap-4 rounded-16px border-2 p-5 pr-12 text-left transition-colors [-webkit-app-region:no-drag]';

type ModeType = 'consumer' | 'enterprise';

function isValidServerUrl(url: string): boolean {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, boolean>).__E2E_TEST__) {
    return url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
  }

  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ModeSetup() {
  const { t } = useTranslation();
  const { logo } = useBrandConfig();
  const [selectedMode, setSelectedMode] = useState<ModeType>('consumer');
  const [serverUrl, setServerUrl] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isConsumerServerFormVisible, setIsConsumerServerFormVisible] = useState(false);
  const [consumerServerUrl, setConsumerServerUrl] = useState('');

  useEffect(() => {
    void (async () => {
      const raw = await ConfigStorage.get('system.sudoworkServerUrl').catch((): string | undefined => undefined);
      const normalized = normalizeSudoworkServerUrl(raw);
      if (normalized) {
        setConsumerServerUrl(normalized);
        setIsConsumerServerFormVisible(true);
      }
    })();
  }, []);

  const onSelectMode = (mode: ModeType) => {
    setSelectedMode(mode);
    if (mode !== 'enterprise') {
      setServerUrl('');
      setVerifyError(null);
    }
    if (mode !== 'consumer') setIsConsumerServerFormVisible(false);
  };

  const onConsumerNext = async () => {
    try {
      const normalized = normalizeSudoworkServerUrl(consumerServerUrl);
      if (normalized && !isValidServerUrl(normalized)) {
        Message.error(t('setup.serverUrl.invalidUrl'));
        return;
      }

      await ConfigStorage.set('system.sudoworkServerUrl', normalized || undefined);
      await setAppMode('c');
      await ipcBridge.application.startConsumerServices.invoke();
      window.location.reload();
    } catch (error) {
      console.error('[ModeSetup] Failed to set consumer mode:', error);
      Message.error(t('setup.mode.saveFailed'));
    }
  };

  const onVerifyServer = async () => {
    const url = serverUrl.trim();
    if (!url || !isValidServerUrl(url)) {
      Message.error(t('setup.serverUrl.invalidUrl'));
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);

    try {
      const normalizedUrl = url.replace(/\/+$/, '');
      const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: normalizedUrl });

      if (!result.success || !result.data) {
        setVerifyError(t('setup.mode.enterprise.invalidResponse'));
        return;
      }

      const tenantConfig = resolveTenantConfig(result.data);
      await setAppMode('e');
      await ConfigStorage.set('eeclaw.serverUrl', normalizedUrl);
      await ConfigStorage.set('eeclaw.tenantName', tenantConfig.app_company_name);
      localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify(createTenantConfigCache(tenantConfig)));
      await ipcBridge.application.startConsumerServices.invoke();
      window.location.reload();
    } catch (error) {
      console.error('[ModeSetup] Server verification failed:', error);
      setVerifyError(t('setup.mode.enterprise.connectionFailed'));
    } finally {
      setIsVerifying(false);
    }
  };

  const isConsumerSelected = selectedMode === 'consumer';
  const isEnterpriseSelected = selectedMode === 'enterprise';
  const isConsumerUrlInvalid = consumerServerUrl.trim().length > 0 && !isValidServerUrl(consumerServerUrl.trim());
  const isEnterpriseUrlInvalid = serverUrl.trim().length > 0 && !isValidServerUrl(serverUrl.trim());

  return (
    <div className='relative min-h-screen w-full overflow-x-hidden overflow-y-auto bg-background text-foreground [-webkit-app-region:drag]'>
      <div className='pointer-events-none fixed inset-0 overflow-hidden' aria-hidden='true'>
        <div className='absolute -right-80px -top-120px h-320px w-320px rounded-full bg-accent opacity-70 blur-64px' />
        <div className='absolute -bottom-120px -left-80px h-320px w-320px rounded-full bg-accent opacity-70 blur-64px' />
      </div>

      {isWindowControlsVisible && (
        <div className='fixed right-0 top-0 z-50 h-36px [-webkit-app-region:no-drag]'>
          <WindowControls />
        </div>
      )}

      <main className='relative z-1 mx-auto flex min-h-screen w-full max-w-820px items-center px-5 py-12 sm:px-8'>
        <section className='w-full rounded-24px border border-border bg-card p-6 shadow-xl [-webkit-app-region:no-drag] sm:p-9'>
          <header className='mb-8 flex flex-col items-center text-center'>
            <div className='mb-5 flex h-64px w-64px items-center justify-center rounded-18px border border-border bg-muted shadow-sm'>
              <img src={logo} alt='' className='h-44px w-44px' />
            </div>
            <h1 className='m-0 text-26px font-700 leading-34px text-foreground'>{t('setup.mode.title', { name: brand.displayName })}</h1>
            <p className='mb-0 mt-2 max-w-520px text-14px leading-22px text-foreground-secondary'>{t('setup.mode.subtitle')}</p>
          </header>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <button type='button' aria-pressed={isConsumerSelected} className={`${MODE_CARD_CLASS_NAME} ${isConsumerSelected ? 'border-border bg-secondary' : 'border-border bg-card hover:border-input hover:bg-muted'}`} onClick={() => onSelectMode('consumer')}>
              <span className={`flex h-44px w-44px shrink-0 items-center justify-center rounded-12px ${isConsumerSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}>
                <UserRound size={22} strokeWidth={1.8} />
              </span>
              <span className='min-w-0'>
                <span className='block text-15px font-650 text-foreground'>{t('setup.mode.consumer.title')}</span>
                <span className='mt-1 block text-12px leading-19px text-foreground-secondary'>{t('setup.mode.consumer.description')}</span>
              </span>
              {isConsumerSelected && (
                <span className='absolute right-4 top-4 flex h-22px w-22px items-center justify-center rounded-full bg-primary text-primary-foreground'>
                  <Check size={14} strokeWidth={2.5} />
                </span>
              )}
            </button>

            <button type='button' aria-pressed={isEnterpriseSelected} className={`${MODE_CARD_CLASS_NAME} ${isEnterpriseSelected ? 'border-border bg-secondary' : 'border-border bg-card hover:border-input hover:bg-muted'}`} onClick={() => onSelectMode('enterprise')}>
              <span className={`flex h-44px w-44px shrink-0 items-center justify-center rounded-12px ${isEnterpriseSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}>
                <Building2 size={22} strokeWidth={1.8} />
              </span>
              <span className='min-w-0'>
                <span className='block text-15px font-650 text-foreground'>{t('setup.mode.enterprise.title')}</span>
                <span className='mt-1 block text-12px leading-19px text-foreground-secondary'>{t('setup.mode.enterprise.description')}</span>
              </span>
              {isEnterpriseSelected && (
                <span className='absolute right-4 top-4 flex h-22px w-22px items-center justify-center rounded-full bg-primary text-primary-foreground'>
                  <Check size={14} strokeWidth={2.5} />
                </span>
              )}
            </button>
          </div>

          {isConsumerSelected && (
            <div className='mt-5 rounded-16px border border-border bg-muted p-4'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <div className='text-13px font-600 text-foreground'>{t('setup.mode.consumer.connectionTitle')}</div>
                  <div className='mt-1 text-12px leading-18px text-foreground-secondary'>{t('setup.mode.consumer.connectionDescription')}</div>
                </div>
                <Button type='text' size='small' icon={<Settings2 size={15} />} onClick={() => setIsConsumerServerFormVisible((isVisible) => !isVisible)}>
                  {isConsumerServerFormVisible ? t('setup.mode.collapse') : t('setup.mode.configure')}
                </Button>
              </div>

              {isConsumerServerFormVisible && (
                <div className='mt-4 border-t border-border pt-4'>
                  <label className='mb-2 block text-12px font-600 text-foreground'>{t('setup.serverUrl.toggle')}</label>
                  <Input id='consumer-server-url' size='large' placeholder={t('setup.serverUrl.placeholder')} value={consumerServerUrl} onChange={setConsumerServerUrl} className='input-on-muted' />
                  <p className={`mb-0 mt-2 text-12px ${isConsumerUrlInvalid ? 'text-destructive' : 'text-foreground-tertiary'}`}>{isConsumerUrlInvalid ? t('setup.serverUrl.invalidUrl') : t('setup.serverUrl.hint')}</p>
                </div>
              )}
            </div>
          )}

          {isEnterpriseSelected && (
            <div className='mt-5 rounded-16px border border-border bg-muted p-4'>
              <label className='mb-2 block text-13px font-600 text-foreground'>{t('setup.mode.enterprise.serverLabel')}</label>
              <Input
                id='enterprise-server-url'
                size='large'
                placeholder={t('setup.mode.enterprise.serverPlaceholder')}
                value={serverUrl}
                className='input-on-muted'
                onChange={(value) => {
                  setServerUrl(value);
                  setVerifyError(null);
                }}
              />
              <p className={`mb-0 mt-2 text-12px ${isEnterpriseUrlInvalid ? 'text-destructive' : serverUrl.trim().startsWith('http://') ? 'text-warning' : 'text-foreground-tertiary'}`}>
                {isEnterpriseUrlInvalid ? t('setup.serverUrl.invalidUrl') : serverUrl.trim().startsWith('http://') ? t('setup.mode.enterprise.httpsHint') : t('setup.mode.enterprise.serverHint')}
              </p>
              {verifyError && <div className='mt-4 rounded-10px border border-destructive bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] px-3 py-2 text-12px text-destructive'>{verifyError}</div>}
            </div>
          )}

          <div className='mt-6'>
            {isConsumerSelected ? (
              <Button type='primary' size='large' long onClick={onConsumerNext} disabled={isConsumerUrlInvalid} className='h-12 rounded-lg text-14px! font-650!'>
                {t('setup.mode.consumer.action')}
              </Button>
            ) : (
              <Button type='primary' size='large' long loading={isVerifying} onClick={() => void onVerifyServer()} disabled={!serverUrl.trim() || isEnterpriseUrlInvalid || isVerifying} className='h-12 rounded-lg text-14px! font-650!'>
                {isVerifying ? t('setup.mode.enterprise.verifying') : t('setup.mode.enterprise.action')}
              </Button>
            )}
            <p className='mb-0 mt-3 text-center text-11px leading-18px text-foreground-tertiary'>{t('setup.mode.footerHint')}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
