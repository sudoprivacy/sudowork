import { Collapse } from '@arco-design/web-react';
import React from 'react';
import type { ChannelConfig } from '../types';
import ChannelHeader from './ChannelHeader';

interface ChannelItemProps {
  channel: ChannelConfig;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

const ChannelItem: React.FC<ChannelItemProps> = ({ channel, isCollapsed, onToggleCollapse, onToggleEnabled }) => {
  return (
    <div data-channel-id={channel.id} data-channel-status={channel.status} data-channel-extension={channel.isExtension ? 'true' : 'false'} className='overflow-hidden rd-12px border border-light'>
      <Collapse activeKey={isCollapsed ? [] : ['1']} onChange={onToggleCollapse} className='border-0 [&_.arco-collapse-item-header]:p-0 [&_div.arco-collapse-item-header-title]:flex-1'>
        <Collapse.Item header={<ChannelHeader channel={channel} collapsed={isCollapsed} onToggleEnabled={onToggleEnabled} />} name='1'>
          {channel.content}
        </Collapse.Item>
      </Collapse>
    </div>
  );
};

export default ChannelItem;
