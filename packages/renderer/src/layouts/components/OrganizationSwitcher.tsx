import React, { useEffect, useState } from 'react';
import { Alert, Modal, Select } from '@arco-design/web-react';
import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { eeclaw } from '@sudowork/host-bridge/ipcBridge';
import type { AccountOrganizations } from '@sudowork/contracts/auth';
import { useAuth } from '@renderer/context/AuthContext';

/** The same enterprise selector is used by the desktop and browser hosts. */
export default function OrganizationSwitcher({ onReload }: IOrganizationSwitcherProps) {
  const { t } = useTranslation();
  const { user, switchOrganization } = useAuth();
  const [snapshot, setSnapshot] = useState<{ userId: string; organizations: AccountOrganizations['organizations'] } | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [pendingOrganization, setPendingOrganization] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCanceled = false;
    setSnapshot(null);
    setPendingOrganization(null);
    setError(null);
    if (user?.id) {
      const userId = user.id;
      void eeclaw.getOrganizations
        .invoke()
        .then((result) => {
          if (!isCanceled && result.success && result.data) setSnapshot({ userId, organizations: result.data.organizations });
        })
        .catch(() => {});
    }
    return () => {
      isCanceled = true;
    };
  }, [user?.id]);

  const organizations = snapshot?.userId === user?.id ? (snapshot?.organizations ?? []) : [];
  if (organizations.length < 2) return null;

  function onChange(orgId: string) {
    if (isSwitching || orgId === user?.enterprise_code) return;
    const organization = organizations.find((item) => item.id === orgId);
    if (!organization) return;
    setError(null);
    setPendingOrganization(organization);
  }

  async function onConfirm() {
    if (!pendingOrganization || isSwitching) return;
    setIsSwitching(true);
    setError(null);
    try {
      const result = await switchOrganization(pendingOrganization.id);
      if (!result.success) {
        if (result.code && result.code !== 'authRejected' && result.code !== 'invalidCredentials') {
          // The server may already have selected a new cookie identity. Reload
          // the Agent list so private data uses the actual authenticated owner.
          onReload();
          return;
        }
        setError(result.message || t('common.organizationSwitch.failed'));
        return;
      }
      setPendingOrganization(null);
      onReload();
    } catch {
      onReload();
    } finally {
      setIsSwitching(false);
    }
  }

  function onCancel() {
    if (isSwitching) return;
    setPendingOrganization(null);
    setError(null);
  }

  return (
    <>
      <Select
        className='mb-2 w-full'
        aria-label={t('common.organizationSwitch.title')}
        prefix={<Building2 size={16} aria-hidden />}
        value={user?.enterprise_code}
        disabled={isSwitching}
        loading={isSwitching}
        options={organizations.map((org) => ({ label: org.name, value: org.id }))}
        onChange={onChange}
      />
      <Modal
        title={t('common.organizationSwitch.title')}
        style={{ maxWidth: 'calc(100vw - 2rem)' }}
        visible={pendingOrganization !== null}
        confirmLoading={isSwitching}
        cancelButtonProps={{ disabled: isSwitching }}
        closable={!isSwitching}
        maskClosable={!isSwitching}
        onOk={onConfirm}
        onCancel={onCancel}
      >
        <p className='mb-3'>{pendingOrganization?.name}</p>
        <p>{t('common.organizationSwitch.confirm')}</p>
        {error && <Alert className='mt-3' type='error' content={error} />}
      </Modal>
    </>
  );
}

interface IOrganizationSwitcherProps {
  onReload: () => void;
}
