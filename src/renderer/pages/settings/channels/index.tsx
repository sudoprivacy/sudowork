import React from 'react';
import WebuiModalContent from '@/renderer/components/SettingsModal/contents/WebuiModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';

const WebuiSettings: React.FC = () => {
  return (
    <PageWrapper>
      <WebuiModalContent />
    </PageWrapper>
  );
};

export default WebuiSettings;
