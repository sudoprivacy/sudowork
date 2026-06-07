/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { defaultAgentForMode } from '../../src/common/acp/defaultAgent';
import { DEFAULT_PRESET_AGENT_TYPE } from '../../src/types/acpTypes';

describe('defaultAgentForMode', () => {
  it('returns the preset agent default in consumer mode', () => {
    expect(defaultAgentForMode(false)).toBe(DEFAULT_PRESET_AGENT_TYPE);
  });

  it("returns 'remote-agent' in enterprise mode", () => {
    expect(defaultAgentForMode(true)).toBe('remote-agent');
  });
});
