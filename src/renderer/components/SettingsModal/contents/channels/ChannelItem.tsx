/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Collapse } from '@arco-design/web-react';
import React from 'react';
import ChannelHeader from './ChannelHeader';
import type { ChannelConfig } from './types';

interface ChannelItemProps {
  channel: ChannelConfig;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

const ChannelItem: React.FC<ChannelItemProps> = ({ channel, isCollapsed, onToggleCollapse, onToggleEnabled }) => {
  return (
    <div data-channel-id={channel.id} data-channel-status={channel.status} data-channel-extension={channel.isExtension ? 'true' : 'false'} className='overflow-hidden rd-12px border border-light'>
      <Collapse activeKey={isCollapsed ? [] : ['1']} onChange={onToggleCollapse} className='border-0 bg-transparent [&_.arco-collapse-item-icon]:hidden [&_.arco-collapse-item-header]:px-0 [&_.arco-collapse-item-header]:py-0 [&_div.arco-collapse-item-header-title]:flex-1'>
        <Collapse.Item
          header={<ChannelHeader channel={channel} collapsed={isCollapsed} onToggleEnabled={onToggleEnabled} />}
          name='1'
          className='[&_div.arco-collapse-item-content-box]:px-12px [&_div.arco-collapse-item-content-box]:pb-12px [&_div.arco-collapse-item-content-box]:pt-0 md:[&_div.arco-collapse-item-content-box]:px-16px'
        >
          {channel.content}
        </Collapse.Item>
      </Collapse>
    </div>
  );
};

export default ChannelItem;
