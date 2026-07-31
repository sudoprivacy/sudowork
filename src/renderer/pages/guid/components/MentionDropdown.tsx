/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Menu } from '@arco-design/web-react';
import { Bot } from 'lucide-react';
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
    <div ref={menuRef} className='overflow-hidden border border-border-deep bg-popover shadow-lg rd-12px'>
      <Menu selectedKeys={[selectedKey]} onClickMenuItem={(key) => onSelect(String(key))} className='min-w-180px max-h-200px overflow-auto'>
        {options.length > 0 ? (
          options.map((option, index) => (
            <Menu.Item key={option.key} data-mention-index={index}>
              <div className='flex items-center gap-8px'>
                {option.avatarImage ? (
                  <img src={resolveExtensionAssetUrl(option.avatarImage)} alt='' width={16} height={16} style={{ objectFit: 'contain' }} />
                ) : option.avatar ? (
                  <span style={{ fontSize: 14, lineHeight: '16px' }}>{option.avatar}</span>
                ) : option.logo ? (
                  <img src={option.logo} alt={option.label} width={16} height={16} style={{ objectFit: 'contain' }} />
                ) : (
                  <Bot size={16} />
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
