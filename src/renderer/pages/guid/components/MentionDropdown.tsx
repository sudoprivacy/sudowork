import { Menu } from '@arco-design/web-react';
import { Robot } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { MentionOption } from '../types';

type MentionDropdownProps = {
  menuRef: React.RefObject<HTMLDivElement>;
  options: MentionOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
};

const MentionDropdown: React.FC<MentionDropdownProps> = ({ menuRef, options, selectedKey, onSelect }) => {
  const { t } = useTranslation();

  return (
    <div ref={menuRef} className='border border-[var(--ui-border-strong)] rd-12px shadow-lg overflow-hidden' style={{ boxShadow: '0 0 0 1px var(--ui-border-strong), 0 12px 24px rgba(0, 0, 0, 0.12)' }}>
      <Menu selectedKeys={[selectedKey]} onClickMenuItem={(key) => onSelect(String(key))} className='min-w-45 max-h-50 overflow-auto'>
        {options.length > 0 ? (
          options.map((option, index) => (
            <Menu.Item key={option.key} data-mention-index={index}>
              <div className='flex items-center gap-2'>
                {option.avatarImage ? (
                  <img src={resolveExtensionAssetUrl(option.avatarImage)} alt='' width={16} height={16} style={{ objectFit: 'contain' }} />
                ) : option.avatar ? (
                  <span style={{ fontSize: 14, lineHeight: '16px' }}>{option.avatar}</span>
                ) : option.logo ? (
                  <img src={option.logo} alt={option.label} width={16} height={16} style={{ objectFit: 'contain' }} />
                ) : (
                  <Robot theme='outline' size={16} />
                )}
                <span>{option.label}</span>
              </div>
            </Menu.Item>
          ))
        ) : (
          <Menu.Item key='empty' disabled>
            {t('conversation.welcome.none', { defaultValue: 'None' })}
          </Menu.Item>
        )}
      </Menu>
    </div>
  );
};

export default MentionDropdown;
