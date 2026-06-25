/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import RuntimeModalContent from '@/renderer/components/SettingsModal/contents/RuntimeModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const RuntimeSettings: React.FC = () => {
  return (
    <PageWrapper contentClassName='max-w-160'>
      <RuntimeModalContent />
    </PageWrapper>
  );
};

export default RuntimeSettings;
