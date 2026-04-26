/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mode indicator showing current app mode (Consumer / Enterprise)
 * Displayed in the title bar
 */

import { Badge } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';

type AppMode = 'c' | 'e';

export function ModeIndicator() {
  const [mode, setMode] = useState<AppMode>('c');

  useEffect(() => {
    void ipcBridge.eeclaw.getMode.invoke().then((res) => {
      if (res.success && res.data) {
        setMode(res.data.mode);
      }
    });
  }, []);

  const isEnterprise = mode === 'e';

  return (
    <Badge
      color={isEnterprise ? '#165dff' : '#52c41a'}
      text={
        <span style={{
          fontSize: 11,
          fontWeight: 500,
          color: isEnterprise ? '#165dff' : '#52c41a',
          letterSpacing: 0.5,
        }}>
          {isEnterprise ? 'ENTERPRISE' : 'CONSUMER'}
        </span>
      }
    />
  );
}
