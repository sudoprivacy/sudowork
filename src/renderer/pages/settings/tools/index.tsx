import React from 'react';
import PageWrapper from '@renderer/components/base/PageWrapper';
import ToolsContent from './components/ToolsContent';

export default function ToolsSettings() {
  return (
    <PageWrapper contentClassName='max-w-300'>
      <ToolsContent />
    </PageWrapper>
  );
}
