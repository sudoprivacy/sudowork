import React from 'react';
import { Button } from '@arco-design/web-react';
import { Right } from '@icon-park/react';

interface AdminRedirectBannerProps {
  visible: boolean;
  serverUrl: string | null | undefined;
}

const AdminRedirectBanner: React.FC<AdminRedirectBannerProps> = ({ visible, serverUrl }) => {
  if (!visible || !serverUrl) return null;

  const handleClick = () => {
    try {
      window.open(serverUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[AdminRedirectBanner] open url failed:', err);
    }
  };

  return (
    <div className='flex items-center justify-between gap-4 px-4 py-3 rd-12px bg-[var(--color-primary-light-1)] border border-solid border-[var(--color-primary-light-3)] mb-4'>
      <div className='text-13px text-foreground'>您是管理员，可前往企业后台配置 MCP 模板、策略与组织级实例。</div>
      <Button type='primary' size='small' onClick={handleClick} icon={<Right theme='outline' size='14' />}>
        前往企业后台
      </Button>
    </div>
  );
};

export default AdminRedirectBanner;
