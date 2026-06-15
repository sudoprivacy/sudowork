/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import SystemModalContent from '@/renderer/components/SettingsModal/contents/SystemModalContent';

const SystemSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <SystemModalContent />
    </SettingsPageWrapper>
  );
};

export default SystemSettings;
