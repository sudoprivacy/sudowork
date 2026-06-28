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
