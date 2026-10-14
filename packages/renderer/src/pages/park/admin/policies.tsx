/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useTranslation } from 'react-i18next';
import { useParkOrgId } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';
import PolicyManagement from './PolicyManagement';

/** 系统运营——政策知识库管理（计划 3.5 admin 独立页）。 */

export default function ParkAdminPoliciesPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();

  return (
    <PageWrapper title={t('park.nav.adminPolicies', '政策知识库')}>
      {parkOrgId && <PolicyManagement parkOrgId={parkOrgId} />}
    </PageWrapper>
  );
}
