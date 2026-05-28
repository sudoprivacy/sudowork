import React from 'react';
import { Tag } from '@arco-design/web-react';
import type { EnterpriseMcpScope } from '../types';

interface ScopeBadgeProps {
  scope: EnterpriseMcpScope;
}

const ScopeBadge: React.FC<ScopeBadgeProps> = ({ scope }) => {
  if (scope === 'org') {
    return (
      <Tag color='blue' size='small'>
        企业 MCP
      </Tag>
    );
  }
  if (scope === 'department') {
    return (
      <Tag color='cyan' size='small'>
        部门 MCP
      </Tag>
    );
  }
  return (
    <Tag color='gray' size='small'>
      个人
    </Tag>
  );
};

export default ScopeBadge;
