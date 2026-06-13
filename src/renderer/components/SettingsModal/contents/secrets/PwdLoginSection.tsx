/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 网站自动登录 (pwd_login) section of 秘钥管理.
 *
 * Lists pwd_login sites — built-in adapters + agent-registered custom sites
 * (via pwdLogin.registerEntry). For each, the user fills username + password
 * and saves; the password flows renderer(form)→main→Vault only and never
 * reaches the agent/LLM. "立即登录" triggers the real auto-fill in the running
 * browser.
 */

import { pwdLogin, type IPwdLoginEntryStatus } from '@/common/ipcBridge';
import { Button, Collapse, Input, Message, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CredentialRow: React.FC<{ entry: IPwdLoginEntryStatus; onSaved: () => void }> = ({ entry, onSaved }) => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const save = useCallback(async () => {
    if (!username || !password) {
      Message.warning(t('pwdLogin.section.needBoth', '请填写用户名和密码'));
      return;
    }
    setSaving(true);
    try {
      const res = await pwdLogin.saveCredential.invoke({ title: entry.title, username, password });
      if (res.success) {
        Message.success(t('pwdLogin.section.saved', '凭证已安全保存到本地密钥库'));
        // Drop the plaintext from component state immediately after save.
        setPassword('');
        onSaved();
      } else {
        Message.error(t('pwdLogin.section.saveFailed', '保存失败'));
      }
    } finally {
      setSaving(false);
    }
  }, [entry.title, username, password, onSaved, t]);

  const loginNow = useCallback(async () => {
    setLoggingIn(true);
    try {
      const res = await pwdLogin.start.invoke({ title: entry.title, optionId: 'allow_once' });
      if (res.ok) {
        Message.success(t('pwdLogin.section.loginOk', '已在浏览器中自动填充并提交登录'));
      } else {
        Message.error(t('pwdLogin.section.loginFailed', { defaultValue: '自动登录失败: {{e}}', e: res.error || 'unknown' }));
      }
    } finally {
      setLoggingIn(false);
    }
  }, [entry.title, t]);

  return (
    <div className='py-8px space-y-10px'>
      <Input value={username} onChange={setUsername} placeholder={t('pwdLogin.section.username', '登录用户名')} autoComplete='off' />
      <Input.Password value={password} onChange={setPassword} placeholder={t('pwdLogin.section.password', '登录密码（仅本地保存，绝不发送给 AI）')} autoComplete='new-password' />
      <div className='flex items-center gap-8px'>
        <Button type='primary' size='small' loading={saving} onClick={save}>
          {t('pwdLogin.section.save', '保存凭证')}
        </Button>
        <Button size='small' loading={loggingIn} disabled={!entry.hasCredential} onClick={loginNow}>
          {t('pwdLogin.section.loginNow', '立即登录')}
        </Button>
        {entry.hasCredential && <span className='text-12px text-[var(--ui-accent-orange)]'>{t('pwdLogin.section.hasCred', '已保存凭证')}</span>}
      </div>
    </div>
  );
};

const PwdLoginSection: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<IPwdLoginEntryStatus[]>([]);

  const load = useCallback(async () => {
    const res = await pwdLogin.listEntries.invoke();
    if (res.success && res.data) setEntries(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (entries.length === 0) return null;

  return (
    <div className='rd-8px border border-solid border-fill-3 overflow-hidden'>
      <div className='px-16px py-12px bg-fill-1'>
        <h3 className='text-14px font-500 text-t-primary m-0'>{t('pwdLogin.section.title', '网站自动登录')}</h3>
        <div className='text-12px text-t-tertiary mt-2px'>{t('pwdLogin.section.desc', '为网站保存登录凭证，sudowork 自动填表并识别验证码登录。密码仅存于本地 Nexus 密钥库，绝不进入 AI 上下文。')}</div>
      </div>
      <Collapse bordered={false}>
        {entries.map((e) => (
          <Collapse.Item
            key={e.title}
            name={e.title}
            header={
              <div className='flex items-center gap-8px'>
                <span className='text-14px text-t-primary'>{e.title}</span>
                {e.source === 'custom' && (
                  <Tag size='small' color='arcoblue'>
                    {t('pwdLogin.section.custom', '自定义')}
                  </Tag>
                )}
                {e.hasCaptcha && (
                  <Tag size='small' color='orange'>
                    {t('pwdLogin.section.captcha', '验证码')}
                  </Tag>
                )}
                {e.hasCredential && (
                  <Tag size='small' color='green'>
                    {t('pwdLogin.section.configured', '已配置')}
                  </Tag>
                )}
              </div>
            }
          >
            <div className='text-12px text-t-tertiary mb-6px break-all'>{e.url}</div>
            <CredentialRow entry={e} onSaved={load} />
          </Collapse.Item>
        ))}
      </Collapse>
    </div>
  );
};

export default PwdLoginSection;
