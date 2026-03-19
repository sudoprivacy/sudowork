/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SkillModalContent from '@/renderer/components/SettingsModal/contents/SkillModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const SkillSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <SkillModalContent />
    </SettingsPageWrapper>
  );
};

export default SkillSettings;
