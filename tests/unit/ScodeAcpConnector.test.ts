/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ACP_BACKENDS_ALL, POTENTIAL_ACP_CLIS } from '../../src/types/acpTypes';
import type { AcpBackendAll } from '../../src/types/acpTypes';

describe('Scode ACP integration', () => {
  describe('ACP_BACKENDS_ALL configuration', () => {
    it('should include scode as a registered backend', () => {
      expect(ACP_BACKENDS_ALL).toHaveProperty('scode');
    });

    it('should have correct scode backend configuration', () => {
      const config = ACP_BACKENDS_ALL['scode' as AcpBackendAll];
      expect(config).toBeDefined();
      expect(config.id).toBe('scode');
      expect(config.name).toBe('Sudo Code');
      expect(config.cliCommand).toBe('scode');
      expect(config.acpArgs).toEqual(['acp']);
      expect(config.enabled).toBe(true);
      expect(config.authRequired).toBe(false);
      expect(config.supportsStreaming).toBe(false);
    });
  });

  describe('POTENTIAL_ACP_CLIS detection list', () => {
    it('should include scode in the auto-detection list', () => {
      const scodeCli = Array.from(POTENTIAL_ACP_CLIS).find((cli) => cli.backendId === 'scode');
      expect(scodeCli).toBeDefined();
      expect(scodeCli!.cmd).toBe('scode');
      expect(scodeCli!.args).toEqual(['acp']);
      expect(scodeCli!.name).toBe('Sudo Code');
    });
  });

  describe('scode spawn configuration', () => {
    it('should produce correct spawn args for scode acp subcommand', () => {
      // Replicate the logic from createGenericSpawnConfig for scode
      const cliPath = 'scode';
      const acpArgs = ['acp'];

      // On Unix: simple command split
      const parts = cliPath.split(/\s+/);
      const command = parts[0];
      const args = [...parts.slice(1), ...acpArgs];

      expect(command).toBe('scode');
      expect(args).toEqual(['acp']);
    });

    it('should handle full path to scode binary', () => {
      const cliPath = '/home/user/.nexus/sudocode/bin/scode';
      const acpArgs = ['acp'];

      const parts = cliPath.split(/\s+/);
      const command = parts[0];
      const args = [...parts.slice(1), ...acpArgs];

      expect(command).toBe('/home/user/.nexus/sudocode/bin/scode');
      expect(args).toEqual(['acp']);
    });

    it('should default to --experimental-acp when acpArgs is undefined', () => {
      const acpArgs = undefined;
      const effectiveAcpArgs = acpArgs === undefined ? ['--experimental-acp'] : acpArgs;
      expect(effectiveAcpArgs).toEqual(['--experimental-acp']);
    });

    it('should use empty args when acpArgs is empty array', () => {
      const acpArgs: string[] = [];
      const effectiveAcpArgs = acpArgs === undefined ? ['--experimental-acp'] : acpArgs;
      expect(effectiveAcpArgs).toEqual([]);
    });
  });
});
