/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Avatar root component — MVP-0 placeholder orb.
 *
 * Renders a transparent breathing orb in the center of the avatar window.
 * Subsequent commits will:
 *   - subscribe to avatarApi.onBridge for chat.response.stream events
 *   - drive a 3-state FSM (idle / thinking / error) over orb visuals
 */
const App: React.FC = () => {
  return (
    <div className='orb-container'>
      <div className='orb' />
    </div>
  );
};

export default App;
