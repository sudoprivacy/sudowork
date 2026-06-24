/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import CronModalContent from '@/renderer/components/SettingsModal/contents/CronModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const CronSettings: React.FC = () => {
  return (
    <PageWrapper>
      <CronModalContent />
    </PageWrapper>
  );
};

export default CronSettings;
