/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ToolsModalContent from '@/renderer/components/SettingsModal/contents/ToolsModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const ToolsSettings: React.FC = () => {
  return (
    <PageWrapper contentClassName='max-w-300'>
      <ToolsModalContent />
    </PageWrapper>
  );
};

export default ToolsSettings;
