/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SkillModalContent from '@/renderer/components/SettingsModal/contents/SkillModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const SkillSettings: React.FC = () => {
  return (
    <PageWrapper contentClassName='max-w-300'>
      <SkillModalContent />
    </PageWrapper>
  );
};

export default SkillSettings;
