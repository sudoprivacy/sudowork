/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import RuntimeModalContent from '@/renderer/components/SettingsModal/contents/RuntimeModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const RuntimeSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-640px'>
      <RuntimeModalContent />
    </SettingsPageWrapper>
  );
};

export default RuntimeSettings;
