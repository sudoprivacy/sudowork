/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AgentModalContent from '@/renderer/components/SettingsModal/contents/AgentModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const AgentSettings: React.FC = () => {
  return (
    <PageWrapper contentClassName='max-w-240'>
      <AgentModalContent />
    </PageWrapper>
  );
};

export default AgentSettings;
