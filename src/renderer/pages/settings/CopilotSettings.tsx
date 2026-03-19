/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import OpenClawModalContent from '@/renderer/components/SettingsModal/contents/CopilotModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const CopilotSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <OpenClawModalContent />
    </SettingsPageWrapper>
  );
};

export default CopilotSettings;
