import React, { useEffect, useMemo, useState } from 'react';
import { Input, Button, Message, Spin } from '@arco-design/web-react';
import AionModal from '@/renderer/components/base/AionModal';
import { normalizeInstallError } from '../utils/normalizeError';
import type { EnterpriseMcpServerDto, EnterpriseMcpUserConfigItem } from '../types';

interface EditConfigModalProps {
  visible: boolean;
  server: EnterpriseMcpServerDto | null;
  /** Prototype 模式下不调真实接口；Phase B 由 hooks 注入 */
  loadConfig?: (serverId: string) => Promise<{ schema: EnterpriseMcpUserConfigItem[]; values: Record<string, string> }>;
  /** Phase B 注入：批量 PUT /me/mcp-servers/:id/user-config */
  saveConfig?: (serverId: string, config_values: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}

const EditConfigModal: React.FC<EditConfigModalProps> = ({ visible, server, loadConfig, saveConfig, onCancel }) => {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [schema, setSchema] = useState<EnterpriseMcpUserConfigItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [missingKeys, setMissingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible || !server) return;
    let cancelled = false;

    // 每次打开重置高亮态
    setMissingKeys(new Set());

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
      } catch {
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

  // schema 中所有合法 key 的集合，用于过滤未声明 key（后端会静默忽略，前端按规范同步过滤）
  const schemaKeys = useMemo(() => new Set(schema.map((it) => it.key)), [schema]);

  if (!server) return null;

  const handleSave = async () => {
    if (!saveConfig) {
      // 原型/未注入兜底
      Message.info('保存功能未启用');
      return;
    }

    // 收集要提交的 config_values：
    // - 仅保留 schema 中声明的 key
    // - 仅保留非空字符串值（与后端 校验规则 一致；空字符串视为"清除该项"由后端全量覆盖删除）
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!schemaKeys.has(k)) continue;
      if (typeof v === 'string' && v.length > 0) {
        payload[k] = v;
      }
    }

    setSubmitting(true);
    try {
      await saveConfig(server.id, payload);
      Message.success('保存成功');
      onCancel();
    } catch (err) {
      const norm = normalizeInstallError(err);
      if (norm.code === 'missing_config' && norm.missingKeys && norm.missingKeys.length > 0) {
        setMissingKeys(new Set(norm.missingKeys));
      }
      Message.error(norm.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AionModal
      visible={visible}
      size='medium'
      // size='medium' 预设含 height: 400px，但本弹窗内容（少量配置项）高度通常远小于此值，
      // 会在按钮下方留下空白；用 height: 'auto' 覆盖让其按内容自适应。
      style={{ height: 'auto' }}
      header={`修改配置 · ${server.display_name || server.name}`}
      onCancel={onCancel}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type='primary' onClick={() => void handleSave()} loading={submitting} disabled={loading}>
            保存
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className='f-center py-15'>
          <Spin size={28} />
        </div>
      ) : schema.length === 0 ? (
        <div className='text-13px text-tertiary py-6 text-center bg-fill-1 rd-8px'>此 MCP 暂无可编辑的用户配置项</div>
      ) : (
        <div className='flex flex-col gap-3.5 py-1'>
          {schema.map((it) => (
            <div key={it.key} className='flex flex-col gap-1.5'>
              <label className='block text-13px text-foreground'>
                {it.name}
                {it.required && <span className='text-red-500 ml-1'>*</span>}
              </label>
              {it.description && <div className='text-12px text-tertiary'>{it.description}</div>}
              <Input
                placeholder={it.target === 'headers' ? `请求头 ${it.key}` : `环境变量 ${it.key}`}
                value={values[it.key] ?? ''}
                onChange={(v) => {
                  setValues((prev) => ({ ...prev, [it.key]: v }));
                  if (missingKeys.has(it.key)) {
                    setMissingKeys((prev) => {
                      const next = new Set(prev);
                      next.delete(it.key);
                      return next;
                    });
                  }
                }}
                error={missingKeys.has(it.key)}
                disabled={submitting}
              />
            </div>
          ))}
        </div>
      )}
    </AionModal>
  );
};

export default EditConfigModal;
