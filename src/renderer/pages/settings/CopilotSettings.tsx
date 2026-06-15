/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import CopilotModalContent from '@/renderer/components/SettingsModal/contents/CopilotModalContent';

const CopilotSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <CopilotModalContent />
    </SettingsPageWrapper>
  );
};

export default CopilotSettings;
