/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import PageWrapper from '@renderer/components/base/PageWrapper';
import RuntimeModalContent from './components/RuntimeModalContent';

export default function RuntimeSettings() {
  return (
    <PageWrapper contentClassName='max-w-160'>
      <RuntimeModalContent />
    </PageWrapper>
  );
}
