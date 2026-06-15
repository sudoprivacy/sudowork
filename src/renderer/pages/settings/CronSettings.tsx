/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import CronModalContent from '@/renderer/components/SettingsModal/contents/CronModalContent';

const CronSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <CronModalContent />
    </SettingsPageWrapper>
  );
};

export default CronSettings;
