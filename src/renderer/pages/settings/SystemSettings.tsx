/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import SystemModalContent from '@/renderer/components/SettingsModal/contents/SystemModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const SystemSettings: React.FC = () => {
  return (
    <PageWrapper>
      <SystemModalContent />
    </PageWrapper>
  );
};

export default SystemSettings;
