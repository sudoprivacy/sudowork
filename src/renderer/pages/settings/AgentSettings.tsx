/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AgentModalContent from '@/renderer/components/SettingsModal/contents/AgentModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const AgentSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <AgentModalContent />
    </SettingsPageWrapper>
  );
};

export default AgentSettings;
