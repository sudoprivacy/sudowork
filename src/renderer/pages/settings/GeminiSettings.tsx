/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import GeminiModalContent from '@/renderer/components/SettingsModal/contents/GeminiModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const GeminiSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <GeminiModalContent />
    </SettingsPageWrapper>
  );
};

export default GeminiSettings;
