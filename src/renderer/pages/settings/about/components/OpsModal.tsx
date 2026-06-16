/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Message, Modal, Tooltip, Typography } from '@arco-design/web-react';
import { Edit } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
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
        Message.warning('无法读取配置文件内容');
      }
    } catch (error) {
      Message.error('读取配置失败');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const handleSaveRawConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const parsed = JSON.parse(configContent);
      const res = await ipcBridge.scode.saveConfig.invoke({ config: parsed });
      if (res?.success) {
        setEditVisible(false);
        Message.success('配置已保存');
        onConfigSaved?.();
      } else {
        Message.error(res?.msg || '保存配置失败');
      }
    } catch (error) {
      Message.error('JSON 格式错误：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setConfigLoading(false);
    }
  }, [configContent, onConfigSaved]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const restartGateway = useCallback(async () => {
    try {
      Modal.confirm({
        title: '重启 Sudo Code Gateway',
        content: '确定要重启 Sudo Code Gateway 吗？这可能会中断正在进行的对话。',
        okText: '确定',
        cancelText: '取消',
        onOk: async () => {
          const res = await ipcBridge.sudoclaw.restartGateway.invoke();
          if (res?.success) {
            Message.success('Gateway 重启中...');
          } else {
            Message.error(res?.msg || '重启失败');
          }
        },
      });
    } catch (error) {
      Message.error('重启失败');
    }
  }, []);

  return (
    <>
      <Modal
        title={
          <div className='flex items-center gap-2'>
            <span>运维中心</span>
          </div>
        }
        visible={visible}
        onCancel={onClose}
        footer={null}
        style={{ width: 500 }}
      >
        <div className='flex flex-col gap-4'>
          <div className='flex items-center justify-between p-3 bg-fill-1 rd-8px'>
            <div className='flex-1'>
              <div className='text-14px text-foreground font-500'>Sudo Code 配置文件</div>
              <Tooltip content='~/.nexus/sudocode/sudocode.json'>
                <div className='text-12px text-tertiary mt-0.5'>直接编辑配置文件</div>
              </Tooltip>
            </div>
            <Button size='small' icon={<Edit theme='outline' size='14' />} onClick={openConfigEditor} loading={configLoading}>
              编辑配置
            </Button>
          </div>

          <div className='text-12px text-tertiary text-center'>此区域仅供运维人员使用</div>
        </div>
      </Modal>

      {/* 配置编辑 Modal */}
      <Modal title='编辑 Sudo Code 配置' visible={editVisible} onOk={handleSaveRawConfig} onCancel={() => setEditVisible(false)} style={{ width: 700 }} confirmLoading={configLoading}>
        <div className='flex flex-col gap-2'>
          <Tooltip content={configPath}>
            <Text type='secondary' className='text-12px'>
              路径：{configPath}
            </Text>
          </Tooltip>
          <Input.TextArea value={configContent} onChange={(value) => setConfigContent(value)} style={{ height: 400, fontFamily: 'monospace', fontSize: 13 }} />
        </div>
      </Modal>
    </>
  );
};

export default OpsModal;
