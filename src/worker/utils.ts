/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pipe } from './fork/pipe';
import pipe from './fork/pipe';

// Safety hook is injected via -r flag by ForkTask when enabled
// hook.js automatically initializes and listens for 'safety.hook.toggle' messages
// No additional code needed here

export const forkTask = (task: (data?: any, pipe?: Pipe) => Promise<any>) => {
  pipe.on('start', (data: any, deferred) => {
    deferred.with(task(data, pipe));
  });
};