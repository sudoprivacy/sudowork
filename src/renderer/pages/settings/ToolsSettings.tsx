/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import ToolsModalContent from '@/renderer/components/SettingsModal/contents/ToolsModalContent';

const ToolsSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-300'>
      <ToolsModalContent />
    </SettingsPageWrapper>
  );
};

export default ToolsSettings;
