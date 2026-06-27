import React from 'react';
import CopilotModalContent from '@/renderer/pages/settings/copilot/components/CopilotModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const CopilotSettings: React.FC = () => {
  return (
    <PageWrapper>
      <CopilotModalContent />
    </PageWrapper>
  );
};

export default CopilotSettings;
