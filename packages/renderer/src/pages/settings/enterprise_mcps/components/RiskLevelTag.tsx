/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tag } from '@arco-design/web-react';
import type { EnterpriseMcpRiskLevel } from '../types';

interface RiskLevelTagProps {
  level: EnterpriseMcpRiskLevel;
}

const LABEL: Record<EnterpriseMcpRiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const COLOR: Record<EnterpriseMcpRiskLevel, 'green' | 'orange' | 'red'> = {
  low: 'green',
  medium: 'orange',
  high: 'red',
};

const RiskLevelTag: React.FC<RiskLevelTagProps> = ({ level }) => {
  return (
    <Tag color={COLOR[level]} size='small'>
      {LABEL[level]}
    </Tag>
  );
};

export default RiskLevelTag;
