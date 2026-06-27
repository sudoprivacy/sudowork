/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Message, Modal, Tooltip, Typography } from '@arco-design/web-react';
import { IconEdit } from '@arco-design/web-react/icon';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';

const { Text } = Typography;

type OpsModalProps = {
  visible: boolean;
  onClose: () => void;
  onConfigSaved?: () => void;
};

/**
 * 运维中心弹窗
 * Ops Center Modal for administrative operations
 */
const OpsModal: React.FC<OpsModalProps> = ({ visible, onClose, onConfigSaved }) => {
  const { t } = useTranslation();
  const [configContent, setConfigContent] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [configPath, setConfigPath] = useState('');
  const [editVisible, setEditVisible] = useState(false);

  const openConfigEditor = useCallback(async () => {
    setConfigLoading(true);
    try {
      const homeDir = await ipcBridge.application.getPath.invoke({ name: 'home' });
      const configFilePath = `${homeDir}/.nexus/sudocode/sudocode.json`;
      setConfigPath(configFilePath);

      const res = await ipcBridge.scode.getConfig.invoke();
      if (res?.success && res.data) {
        setConfigContent(JSON.stringify(res.data, null, 2));
        setEditVisible(true);
      } else {
        Message.warning(t('settings.ops.readConfigContentFailed', '无法读取配置文件内容'));
      }
    } catch {
      Message.error(t('settings.ops.readConfigFailed', '读取配置失败'));
    } finally {
      setConfigLoading(false);
    }
  }, [t]);

  const handleSaveRawConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const parsed = JSON.parse(configContent);
      const res = await ipcBridge.scode.saveConfig.invoke({ config: parsed });
      if (res?.success) {
        setEditVisible(false);
        Message.success(t('settings.ops.configSaved', '配置已保存'));
        onConfigSaved?.();
      } else {
        Message.error(res?.msg || t('settings.ops.saveConfigFailed', '保存配置失败'));
      }
    } catch (error) {
      Message.error(t('settings.ops.jsonFormatError', { message: error instanceof Error ? error.message : String(error), defaultValue: 'JSON 格式错误：{{message}}' }));
    } finally {
      setConfigLoading(false);
    }
  }, [configContent, onConfigSaved, t]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const restartGateway = useCallback(async () => {
    try {
      Modal.confirm({
        title: t('settings.ops.restartGatewayTitle', '重启 Sudo Code Gateway'),
        content: t('settings.ops.restartGatewayConfirm', '确定要重启 Sudo Code Gateway 吗？这可能会中断正在进行的对话。'),
        okText: t('common.confirm', '确定'),
        cancelText: t('common.cancel', '取消'),
        onOk: async () => {
          const res = await ipcBridge.sudoclaw.restartGateway.invoke();
          if (res?.success) {
            Message.success(t('settings.ops.restartGatewayStarting', 'Gateway 重启中...'));
          } else {
            Message.error(res?.msg || t('settings.ops.restartFailed', '重启失败'));
          }
        },
      });
    } catch {
      Message.error(t('settings.ops.restartFailed', '重启失败'));
    }
  }, [t]);

  return (
    <>
      <Modal title={t('settings.ops.title', '运维中心')} visible={visible} onCancel={onClose} footer={null} style={{ width: 500 }}>
        <div className='flex flex-col gap-4'>
          <div className='flex items-center justify-between p-3 border-light rd-8px'>
            <div className='flex-1'>
              <div className='text-14px text-foreground font-500'>{t('settings.ops.configFile', 'Sudo Code 配置文件')}</div>
              <Tooltip content='~/.nexus/sudocode/sudocode.json'>
                <div className='text-12px text-secondary mt-0.5'>{t('settings.ops.editConfigFile', '直接编辑配置文件')}</div>
              </Tooltip>
            </div>
            <Button size='small' icon={<IconEdit />} onClick={openConfigEditor} loading={configLoading}>
              {t('settings.ops.editConfig', '编辑配置')}
            </Button>
          </div>

          <div className='text-12px text-secondary text-center'>{t('settings.ops.staffOnly', '此区域仅供运维人员使用')}</div>
        </div>
      </Modal>

      {/* 配置编辑 Modal */}
      <Modal title={t('settings.ops.editConfigTitle', '编辑 Sudo Code 配置')} visible={editVisible} onOk={handleSaveRawConfig} onCancel={() => setEditVisible(false)} style={{ width: 700 }} confirmLoading={configLoading}>
        <div className='flex flex-col gap-2'>
          <Tooltip content={configPath}>
            <Text type='secondary' className='text-12px'>
              {t('settings.ops.pathLabel', '路径：')}
              {configPath}
            </Text>
          </Tooltip>
          <Input.TextArea value={configContent} onChange={(value) => setConfigContent(value)} style={{ height: 400, fontFamily: 'monospace', fontSize: 13 }} />
        </div>
      </Modal>
    </>
  );
};

export default OpsModal;
