import React, { useMemo, useState } from 'react';
import { Input, Button, Message } from '@arco-design/web-react';
import AionModal from '@/renderer/components/base/AionModal';
import type { EnterpriseMcpTemplateDto } from '../types';

interface InstallConfigModalProps {
  visible: boolean;
  template: EnterpriseMcpTemplateDto | null;
  /** When set (Phase B 真实接口失败回写)，对应 key 渲染红色边框 */
  highlightKeys?: string[];
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (values: { config_values: Record<string, string>; auth_credentials?: Record<string, string>; display_name?: string }) => void;
}

const InstallConfigModal: React.FC<InstallConfigModalProps> = ({ visible, template, highlightKeys, submitting = false, onCancel, onSubmit }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState<string>('');
  const [localMissing, setLocalMissing] = useState<Set<string>>(new Set());

  const items = template?.user_config_items ?? [];
  const authItems = template?.auth_user_items ?? [];

  const highlightSet = useMemo(() => {
    const s = new Set<string>(highlightKeys ?? []);
    localMissing.forEach((k) => s.add(k));
    return s;
  }, [highlightKeys, localMissing]);

  // Reset state when template changes
  React.useEffect(() => {
    if (visible) {
      setValues({});
      setAuthValues({});
      setDisplayName('');
      setLocalMissing(new Set());
    }
  }, [visible, template?.id]);

  if (!template) return null;

  const handleSubmit = () => {
    const missing = new Set<string>();
    items.forEach((it) => {
      if (it.required && !(values[it.key] && values[it.key].trim())) {
        missing.add(it.key);
      }
    });
    authItems.forEach((it) => {
      if (it.required && !(authValues[it.key] && authValues[it.key].trim())) {
        missing.add(it.key);
      }
    });
    if (missing.size > 0) {
      setLocalMissing(missing);
      Message.warning('请填写所有必填项');
      return;
    }
    onSubmit({
      config_values: { ...values },
      ...(Object.keys(authValues).length > 0 ? { auth_credentials: { ...authValues } } : {}),
      ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
    });
  };

  const hasNoConfig = items.length === 0 && authItems.length === 0;

  return (
    <AionModal
      visible={visible}
      size='medium'
      header={`安装 · ${template.name}`}
      onCancel={onCancel}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type='primary' loading={submitting} onClick={handleSubmit}>
            安装
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-4 py-1'>
        {template.description && <div className='text-13px text-secondary leading-relaxed'>{template.description}</div>}

        <div className='flex flex-col gap-2'>
          <label className='block text-13px text-secondary'>显示名称（可选）</label>
          <Input placeholder={`默认：${template.name}`} value={displayName} onChange={setDisplayName} disabled={submitting} />
        </div>

        {hasNoConfig ? (
          <div className='text-13px text-tertiary py-3 text-center bg-fill-1 rd-8px'>此模板无需配置，点击"安装"即可</div>
        ) : (
          <div className='flex flex-col gap-4'>
            {/* 用户配置项区域 */}
            {items.length > 0 && (
              <div className='flex flex-col gap-3.5'>
                <div className='text-13px font-500 text-foreground'>用户配置项</div>
                {items.map((it) => (
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
                        if (highlightSet.has(it.key)) {
                          setLocalMissing((prev) => {
                            const next = new Set(prev);
                            next.delete(it.key);
                            return next;
                          });
                        }
                      }}
                      error={highlightSet.has(it.key)}
                      disabled={submitting}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 鉴权凭据区域 */}
            {authItems.length > 0 && (
              <div className='flex flex-col gap-3.5'>
                <div className='text-13px font-500 text-foreground'>鉴权凭据</div>
                {authItems.map((it) => (
                  <div key={it.key} className='flex flex-col gap-1.5'>
                    <label className='block text-13px text-foreground'>
                      {it.name}
                      {it.required && <span className='text-red-500 ml-1'>*</span>}
                    </label>
                    {it.description && <div className='text-12px text-tertiary'>{it.description}</div>}
                    <Input
                      placeholder={`凭据 ${it.key}`}
                      value={authValues[it.key] ?? ''}
                      onChange={(v) => {
                        setAuthValues((prev) => ({ ...prev, [it.key]: v }));
                        if (highlightSet.has(it.key)) {
                          setLocalMissing((prev) => {
                            const next = new Set(prev);
                            next.delete(it.key);
                            return next;
                          });
                        }
                      }}
                      error={highlightSet.has(it.key)}
                      disabled={submitting}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AionModal>
  );
};

export default InstallConfigModal;
