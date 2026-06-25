/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import GeminiModalContent from '@/renderer/components/SettingsModal/contents/GeminiModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const GeminiSettings: React.FC = () => {
  return (
    <PageWrapper>
      <GeminiModalContent />
    </PageWrapper>
  );
};

export default GeminiSettings;
