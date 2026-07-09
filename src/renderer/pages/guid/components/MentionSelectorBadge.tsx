import { Dropdown } from '@arco-design/web-react';
import { ChevronDown } from 'lucide-react';
import React from 'react';

type MentionSelectorBadgeProps = {
  visible: boolean;
  open: boolean;
  onOpenChange: (visible: boolean) => void;
  agentLabel: string;
  mentionMenu: React.ReactNode;
  onResetQuery: () => void;
};

const MentionSelectorBadge: React.FC<MentionSelectorBadgeProps> = ({ visible, open, onOpenChange, agentLabel, mentionMenu, onResetQuery }) => {
  if (!visible) return null;

  return (
    <div className='flex items-center gap-2 mb-2'>
      <Dropdown
        trigger='click'
        popupVisible={open}
        onVisibleChange={(v) => {
          onOpenChange(v);
          if (v) {
            onResetQuery();
          }
        }}
        droplist={mentionMenu}
      >
        <div className='flex items-center gap-1.5 bg-fill-2 px-2.5 py-1 rd-16px cursor-pointer select-none'>
          <span className='text-14px font-medium text-foreground'>@{agentLabel}</span>
          <ChevronDown size={12} />
        </div>
      </Dropdown>
    </div>
  );
};

export default MentionSelectorBadge;
