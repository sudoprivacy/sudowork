/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

// Windows Job Object native addon loader.
// On non-Windows platforms, exports no-op stubs.

if (process.platform !== 'win32') {
  module.exports = {
    initJobObject: () => false,
    assignProcessToJob: () => false,
    isJobActive: () => false,
  };
} else {
  const { existsSync } = require('fs');
  const { join } = require('path');

  // napi-rs convention: platform-specific binary next to index.js
  const candidates = [
    `win-job-object.${process.platform}-${process.arch}.node`,
    'win-job-object.node',
  ];

  let nativeBinding;
  for (const name of candidates) {
    const path = join(__dirname, name);
    if (existsSync(path)) {
      nativeBinding = require(path);
      break;
    }
  }

  if (!nativeBinding) {
    // Graceful fallback: warn but don't crash.
    // The ProcessSupervisor's taskkill approach still works as a backup.
    console.warn(
      `[win-job-object] Failed to load native module. ` +
      `Job Object cleanup will not be active. ` +
      `Looked for: ${candidates.join(', ')} in ${__dirname}`
    );
    module.exports = {
      initJobObject: () => false,
      assignProcessToJob: () => false,
      isJobActive: () => false,
    };
  } else {
    module.exports = nativeBinding;
  }
}
