/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import CopilotModalContent from '@/renderer/components/SettingsModal/contents/CopilotModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const CopilotSettings: React.FC = () => {
  return (
    <PageWrapper>
      <CopilotModalContent />
    </PageWrapper>
  );
};

export default CopilotSettings;
