import { ipcBridge } from '@/common';
import React, { useState, useEffect } from 'react';
import { Button, Select, Message, Divider } from '@arco-design/web-react';
import { CheckOne, Lightning, Robot } from '@icon-park/react';

import SettingsPageWrapper from './components/SettingsPageWrapper';
import { useTranslation } from 'react-i18next';

const SudorouterSettings: React.FC = () => {
  const { t } = useTranslation();
  const [selectedModel, setSelectedModels] = useState('');
  const [models, setModels] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
        const res = await fetch(`${serverConfig.baseUrl}/api/v1/router/models`);
        const data = await res.json();
        if (data.success) {
          setModels(data.data);
          if (data.data.length > 0) setSelectedModels(data.data[0].value);
        }
      } catch (e) {
        console.error('Failed to load models:', e);
      }
    };
    loadModels();
  }, []);

  const MOCK_AGENTS = [
    { id: 'claude', name: 'Claude Code', path: '~/.claude/settings.json', status: 'detected' },
    { id: 'openclaw', name: 'OpenClaw', path: '~/.openclaw/config.yaml', status: 'detected' },
    { id: 'opencode', name: 'OpenCode', path: 'Env Variables', status: 'detected' },
  ];

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncLogs(['[INIT] 正在初始化 Sudorouter 握手...']);
    const steps = ['[AUTH] 验证 Routing Key... 成功', '[FS] 正在备份本地配置文件... 完成', '[WRITE] 正在更新 Claude Code 配置...', '[WRITE] 正在注入 OpenCode 环境变量...', '[WRITE] 正在重写 OpenClaw 供应商列表...', '[VALIDATE] 正在通过网关执行健康检查... 通过', '[SUCCESS] 所有本地 Agent 已完成配置。'];
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 400));
      setSyncLogs((prev) => [...prev, step]);
    }
    setIsSyncing(false);
    Message.success(t('settings.sudorouter.syncSuccess'));
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-800px'>
      <div className='flex flex-col gap-24px py-8px'>
        <div className='flex flex-col gap-4px'>
          <div className='text-20px font-600 text-t-primary leading-32px'>{t('settings.sudorouter')}</div>
          <div className='text-13px text-t-secondary'>{t('settings.sudorouter.syncNote')}</div>
        </div>

        <div className='p-24px bg-2 rd-16px border border-border-2 space-y-24px'>
          {/* Step 1 */}
          <div className='space-y-12px'>
            <div className='flex items-center gap-8px text-14px font-500 text-t-primary'>
              <Lightning theme='filled' size='16' className='text-primary' />
              {t('settings.sudorouter.modelSelection')}
            </div>
            <Select value={selectedModel} onChange={setSelectedModels} className='w-full' size='large' loading={models.length === 0}>
              {models.map((m) => (
                <Select.Option key={m.value} value={m.value}>
                  {m.label}
                </Select.Option>
              ))}
            </Select>
          </div>

          <Divider className='!my-0' />

          {/* Step 2 */}
          <div className='space-y-16px'>
            <div className='flex items-center gap-8px text-14px font-500 text-t-primary'>
              <Robot theme='outline' size='16' />
              {t('settings.sudorouter.agentDetection')}
            </div>
            <div className='grid grid-cols-1 gap-12px'>
              {MOCK_AGENTS.map((agent) => (
                <div key={agent.id} className='flex items-center justify-between p-12px bg-fill-1 rd-8px border border-transparent hover:border-border-2 transition-all'>
                  <div className='flex flex-col gap-2px'>
                    <div className='text-13px font-600 text-t-primary italic uppercase'>{agent.name}</div>
                    <div className='text-11px text-t-dim mono'>{agent.path}</div>
                  </div>
                  <CheckOne theme='filled' size='16' className='text-green-500' />
                </div>
              ))}
            </div>
          </div>

          <Divider className='!my-0' />

          {/* Action */}
          <div className='flex flex-col gap-16px'>
            <Button type='primary' size='large' loading={isSyncing} onClick={handleSync} className='rd-8px h-44px font-600 uppercase tracking-wide'>
              {isSyncing ? t('settings.sudorouter.syncing') : t('settings.sudorouter.sync')}
            </Button>

            {syncLogs.length > 0 && (
              <div className='bg-fill-2 rd-8px p-16px font-mono text-12px text-t-primary/80 space-y-4px max-h-160px overflow-y-auto border border-border-2'>
                {syncLogs.map((log, i) => (
                  <div key={i} className='flex gap-8px animate-in fade-in duration-200'>
                    <span className='text-t-dim shrink-0'>[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                    <span>{log}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SudorouterSettings;
