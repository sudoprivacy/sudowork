/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import AgentModalContent from '@/renderer/components/SettingsModal/contents/AgentModalContent';

const AgentSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-240'>
      <AgentModalContent />
    </SettingsPageWrapper>
  );
};

export default AgentSettings;
