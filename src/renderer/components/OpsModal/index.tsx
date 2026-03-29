/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Input, Message, Modal, Space, Tooltip, Typography } from '@arco-design/web-react';
import { Edit, Refresh } from '@icon-park/react';
import React, { useCallback, useState } from 'react';

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
      const configFilePath = `${homeDir}/.nexus/sudoclaw/sudoclaw.json`;
      setConfigPath(configFilePath);

      const res = await ipcBridge.sudoclaw.getConfig.invoke();
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
      const res = await ipcBridge.sudoclaw.saveConfig.invoke({ config: parsed });
      if (res?.success) {
        setEditVisible(false);
        Message.success('配置已保存');
        onConfigSaved?.();
        // Prompt user to restart Gateway
        Modal.confirm({
          title: '配置已保存',
          content: '配置已保存成功。需要重启 Gateway 才能生效，是否立即重启？',
          okText: '重启 Gateway',
          cancelText: '稍后重启',
          onOk: async () => {
            const restartRes = await ipcBridge.sudoclaw.restartGateway.invoke();
            if (restartRes?.success) {
              Message.success('Gateway 重启中...');
            } else {
              Message.error(restartRes?.msg || '重启失败');
            }
          },
        });
      } else {
        Message.error(res?.msg || '保存配置失败');
      }
    } catch (error) {
      Message.error('JSON 格式错误：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setConfigLoading(false);
    }
  }, [configContent, onConfigSaved]);

  const restartGateway = useCallback(async () => {
    try {
      Modal.confirm({
        title: '重启 Sudoclaw Gateway',
        content: '确定要重启 Sudoclaw Gateway 吗？这可能会中断正在进行的对话。',
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
          <div className='flex items-center gap-8px'>
            <span>运维中心</span>
          </div>
        }
        visible={visible}
        onCancel={onClose}
        footer={null}
        style={{ width: 500 }}
      >
        <div className='flex flex-col gap-16px'>
          <div className='flex items-center justify-between p-12px bg-fill-1 rd-8px'>
            <div className='flex-1'>
              <div className='text-14px text-t-primary font-500'>Sudoclaw 配置文件</div>
              <Tooltip content='~/.nexus/sudoclaw/sudoclaw.json'>
                <div className='text-12px text-t-tertiary mt-2px'>直接编辑配置文件</div>
              </Tooltip>
            </div>
            <Space>
              <Button size='small' icon={<Edit theme='outline' size='14' />} onClick={openConfigEditor} loading={configLoading}>
                编辑配置
              </Button>
              <Button size='small' icon={<Refresh theme='outline' size='14' />} onClick={restartGateway}>
                重启 Gateway
              </Button>
            </Space>
          </div>

          <div className='text-12px text-t-tertiary text-center'>此区域仅供运维人员使用</div>
        </div>
      </Modal>

      {/* 配置编辑 Modal */}
      <Modal title='编辑 SudoClaw 配置' visible={editVisible} onOk={handleSaveRawConfig} onCancel={() => setEditVisible(false)} style={{ width: 700 }} confirmLoading={configLoading}>
        <div className='flex flex-col gap-8px'>
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
