/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message, Switch } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type SudoClawToggleProps = {
  /** Current enabled state */
  enabled: boolean;
  /** Callback when the user toggles; receives the desired new state */
  onToggle: (enabled: boolean) => Promise<boolean>;
  /** Whether the toggle is disabled (e.g. while loading) */
  disabled?: boolean;
};

/**
 * Toggle switch for enabling / disabling SudoClaw.
 *
 * The parent is responsible for the actual IPC call — this component
 * handles optimistic UI and rollback on failure.
 */
const SudoClawToggle: React.FC<SudoClawToggleProps> = ({ enabled, onToggle, disabled = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleChange = useCallback(
    async (checked: boolean) => {
      setLoading(true);
      try {
        const success = await onToggle(checked);
        if (success) {
          Message.success(checked ? t('sudoclaw.toggle.enableSuccess') : t('sudoclaw.toggle.disableSuccess'));
        } else {
          Message.error(t('sudoclaw.toggle.toggleFailed'));
        }
      } catch {
        Message.error(t('sudoclaw.toggle.toggleFailed'));
      } finally {
        setLoading(false);
      }
    },
    [onToggle, t]
  );

  return (
    <div className='flex items-center gap-12px'>
      <Switch checked={enabled} loading={loading} disabled={disabled} size='small' onChange={handleChange} />
      <span className='text-14px color-[var(--color-text-2)]'>{enabled ? t('sudoclaw.toggle.disable') : t('sudoclaw.toggle.enable')}</span>
    </div>
  );
};

export default SudoClawToggle;
