/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import SkillModalContent from '@/renderer/components/SettingsModal/contents/SkillModalContent';

const SkillSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-300'>
      <SkillModalContent />
    </SettingsPageWrapper>
  );
};

export default SkillSettings;
