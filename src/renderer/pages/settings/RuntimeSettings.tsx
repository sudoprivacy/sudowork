/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import RuntimeModalContent from '@/renderer/components/SettingsModal/contents/RuntimeModalContent';

const RuntimeSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-160'>
      <RuntimeModalContent />
    </SettingsPageWrapper>
  );
};

export default RuntimeSettings;
