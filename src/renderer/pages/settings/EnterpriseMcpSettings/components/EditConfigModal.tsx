import React, { useEffect, useState } from 'react';
import { Input, Button, Message, Spin } from '@arco-design/web-react';
import AionModal from '@/renderer/components/base/AionModal';
import type { EnterpriseMcpServerDto, EnterpriseMcpUserConfigItem } from '../types';

interface EditConfigModalProps {
  visible: boolean;
  server: EnterpriseMcpServerDto | null;
  /** Prototype 模式下不调真实接口；Phase B 由 hooks 注入 */
  loadConfig?: (serverId: string) => Promise<{ schema: EnterpriseMcpUserConfigItem[]; values: Record<string, string> }>;
  onCancel: () => void;
}

/**
 * UI Only — known backend gap §8.1: PUT /me/mcp-servers/:id/user-config/:key
 * body schema not yet documented. Save button shows toast and does not call backend.
 * TODO(backend-contract): wire to PUT once schema is confirmed.
 */
const EditConfigModal: React.FC<EditConfigModalProps> = ({ visible, server, loadConfig, onCancel }) => {
  const [loading, setLoading] = useState(false);
  const [schema, setSchema] = useState<EnterpriseMcpUserConfigItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible || !server) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        if (loadConfig) {
          const result = await loadConfig(server.id);
          if (!cancelled) {
            setSchema(result.schema);
            setValues(result.values);
          }
        } else {
          // Prototype fallback: empty schema (mock 数据不含 user_config_items 视图)
          setSchema([]);
          setValues({});
        }
      } catch (err) {
        if (!cancelled) {
          Message.error('加载用户配置失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [visible, server, loadConfig]);

  if (!server) return null;

  const handleSave = () => {
    Message.info('保存功能开发中（后端 PUT 配置接口待确认）');
    // TODO(backend-contract): PUT /me/mcp-servers/:id/user-config/:key
  };

  return (
    <AionModal
      visible={visible}
      size='medium'
      header={`修改配置 · ${server.display_name || server.name}`}
      onCancel={onCancel}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={onCancel}>取消</Button>
          <Button type='primary' onClick={handleSave} disabled={loading}>
            保存
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className='flex items-center justify-center py-60px'>
          <Spin size={28} />
        </div>
      ) : schema.length === 0 ? (
        <div className='text-13px text-t-tertiary py-24px text-center bg-[var(--color-fill-1)] rd-8px'>此 MCP 暂无可编辑的用户配置项</div>
      ) : (
        <div className='flex flex-col gap-14px py-4px'>
          {schema.map((it) => (
            <div key={it.key} className='flex flex-col gap-6px'>
              <label className='block text-13px text-t-primary'>
                {it.name}
                {it.required && <span className='text-red-500 ml-4px'>*</span>}
              </label>
              {it.description && <div className='text-12px text-t-tertiary'>{it.description}</div>}
              <Input placeholder={it.target === 'headers' ? `请求头 ${it.key}` : `环境变量 ${it.key}`} value={values[it.key] ?? ''} onChange={(v) => setValues((prev) => ({ ...prev, [it.key]: v }))} />
            </div>
          ))}
        </div>
      )}
    </AionModal>
  );
};

export default EditConfigModal;
