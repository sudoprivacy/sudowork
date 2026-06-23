import React, { useMemo, useState } from 'react';
import { Input, Button, Tag, Message } from '@arco-design/web-react';
import { Search, DownloadOne, CheckOne } from '@icon-park/react';
import EmptyState from '@/renderer/components/base/EmptyState';
import McpIcon from '../components/McpIcon';
import RiskLevelTag from '../components/RiskLevelTag';
import InstallConfigModal from '../components/InstallConfigModal';
import type { EnterpriseMcpTemplateDto } from '../types';

interface McpLibraryTabProps {
  templates: EnterpriseMcpTemplateDto[];
  /** 已安装过的模板 id 集合（Phase B 通过后端附加字段计算；prototype 阶段 mock） */
  installedTemplateIds?: Set<string>;
  loading?: boolean;
  /** 安装回调：prototype 仅 toast；Phase B 走真实 POST install */
  onInstall?: (template: EnterpriseMcpTemplateDto, payload: { config_values: Record<string, string>; auth_credentials?: Record<string, string>; display_name?: string }) => Promise<void> | void;
}

const McpLibraryTab: React.FC<McpLibraryTabProps> = ({ templates, installedTemplateIds, loading = false, onInstall }) => {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<EnterpriseMcpTemplateDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Keys flagged by backend `missing_config` errors. Reset on every modal open / template change. */
  const [missingKeys, setMissingKeys] = useState<string[]>([]);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q) && !(t.description ?? '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [templates, search]);

  const handleClickInstall = (tpl: EnterpriseMcpTemplateDto) => {
    setMissingKeys([]);
    if (tpl.user_config_items.length === 0 && (tpl.auth_user_items ?? []).length === 0) {
      // 无需配置 → 直接调用安装
      void doInstall(tpl, { config_values: {} });
      return;
    }
    setActive(tpl);
  };

  const doInstall = async (tpl: EnterpriseMcpTemplateDto, payload: { config_values: Record<string, string>; auth_credentials?: Record<string, string>; display_name?: string }) => {
    setSubmitting(true);
    try {
      if (onInstall) {
        await onInstall(tpl, payload);
      } else {
        // prototype fallback
        await new Promise((r) => setTimeout(r, 300));
        Message.success(`原型：已模拟安装「${tpl.name}」`);
      }
      setActive(null);
      setMissingKeys([]);
    } catch (err) {
      // 后端 missing_config 时，回写 highlight keys；其它错误已由 onInstall toast
      const keys = (err as { missingKeys?: string[] })?.missingKeys;
      if (Array.isArray(keys) && keys.length > 0) {
        setMissingKeys(keys);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      {/* Filter bar */}
      <div className='flex items-center gap-2'>
        <Input allowClear placeholder='搜索模板名称或描述' value={search} onChange={setSearch} prefix={<Search theme='outline' size='14' />} style={{ flex: 1 }} />
      </div>

      {!loading && filtered.length === 0 ? (
        <EmptyState illustrationType='search' title='未找到匹配的模板' description='调整搜索词后再试。' simple />
      ) : (
        <div className='flex flex-col gap-2.5'>
          {filtered.map((tpl) => {
            const installed = installedTemplateIds?.has(tpl.id);
            return (
              <div key={tpl.id} className='flex items-center gap-3 px-4 py-3 rd-12px bg-1 hover:bg-2 transition-colors'>
                <McpIcon icon={tpl.icon} size={40} />
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <span className='text-14px font-500 text-foreground truncate'>{tpl.name}</span>
                    <RiskLevelTag level={tpl.risk_level} />
                    {installed && (
                      <Tag size='small' color='green' icon={<CheckOne theme='outline' size='12' />}>
                        已安装
                      </Tag>
                    )}
                  </div>
                  {tpl.description && <div className='text-12px text-tertiary mt-0.5 truncate'>{tpl.description}</div>}
                  <div className='flex items-center gap-1.5 mt-1'>
                    {tpl.tags.map((tag) => (
                      <span key={tag} className='text-11px text-tertiary px-1.5 py-px rd-4px bg-[var(--color-fill-2)]'>
                        #{tag}
                      </span>
                    ))}
                    <span className='text-11px text-tertiary ml-auto'>已安装 {tpl.downloads} 次</span>
                  </div>
                </div>
                <div className='shrink-0'>
                  {installed ? (
                    <Button type='outline' size='small' disabled icon={<CheckOne theme='outline' size='14' />}>
                      已安装
                    </Button>
                  ) : (
                    <Button type='outline' size='small' icon={<DownloadOne theme='outline' size='14' />} onClick={() => handleClickInstall(tpl)}>
                      安装
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InstallConfigModal
        visible={active !== null}
        template={active}
        submitting={submitting}
        highlightKeys={missingKeys}
        onCancel={() => {
          if (submitting) return;
          setActive(null);
          setMissingKeys([]);
        }}
        onSubmit={(payload) => {
          if (active) void doInstall(active, payload);
        }}
      />
    </div>
  );
};

export default McpLibraryTab;
