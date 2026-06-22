/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import WebuiModalContent from '@/renderer/components/SettingsModal/contents/WebuiModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const WebuiSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <WebuiModalContent />
    </SettingsPageWrapper>
  );
};

export default WebuiSettings;
