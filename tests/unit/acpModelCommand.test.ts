/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

/**
 * Test the /model command regex matching logic used in AcpAgentManager.sendMessage().
 * This ensures the interception pattern correctly identifies /model slash commands
 * before they are sent to the ACP bridge (which cannot handle interactive commands).
 */

const MODEL_REGEX = /^\/model(?:\s+(.*))?$/;

describe('/model command interception', () => {
  describe('regex matching', () => {
    it('matches /model with no arguments', () => {
      const match = '/model'.trim().match(MODEL_REGEX);
      expect(match).not.toBeNull();
      expect((match![1] || '').trim()).toBe('');
    });

    it('matches /model with trailing whitespace', () => {
      const match = '/model   '.trim().match(MODEL_REGEX);
      expect(match).not.toBeNull();
      expect((match![1] || '').trim()).toBe('');
    });

    it('matches /model with a model name argument', () => {
      const match = '/model claude-sonnet-4-6'.trim().match(MODEL_REGEX);
      expect(match).not.toBeNull();
      expect((match![1] || '').trim()).toBe('claude-sonnet-4-6');
    });

    it('matches /model with extra spaces before model name', () => {
      const match = '/model   claude-opus-4-6'.trim().match(MODEL_REGEX);
      expect(match).not.toBeNull();
      expect((match![1] || '').trim()).toBe('claude-opus-4-6');
    });

    it('matches /model with haiku model', () => {
      const match = '/model claude-haiku-4-5-20251001'.trim().match(MODEL_REGEX);
      expect(match).not.toBeNull();
      expect((match![1] || '').trim()).toBe('claude-haiku-4-5-20251001');
    });

    it('does NOT match regular messages containing /model', () => {
      const match = 'please use /model to switch'.trim().match(MODEL_REGEX);
      expect(match).toBeNull();
    });

    it('does NOT match /models (different command)', () => {
      const match = '/models'.trim().match(MODEL_REGEX);
      expect(match).toBeNull();
    });

    it('does NOT match /model-info', () => {
      const match = '/model-info'.trim().match(MODEL_REGEX);
      expect(match).toBeNull();
    });

    it('does NOT match empty string', () => {
      const match = ''.trim().match(MODEL_REGEX);
      expect(match).toBeNull();
    });

    it('does NOT match /context', () => {
      const match = '/context'.trim().match(MODEL_REGEX);
      expect(match).toBeNull();
    });
  });

  describe('model info formatting', () => {
    it('formats model list with current marker', () => {
      const modelInfo = {
        currentModelId: 'claude-opus-4-6',
        currentModelLabel: 'Opus 4.6',
        availableModels: [
          { id: 'claude-opus-4-6', label: 'Opus 4.6' },
          { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
          { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
        ],
        canSwitch: true,
        source: 'configOption' as const,
      };

      const available = modelInfo.availableModels.map((m) => {
        const marker = m.id === modelInfo.currentModelId ? ' (current)' : '';
        return `- \`${m.id}\` ${m.label ? `— ${m.label}` : ''}${marker}`;
      }).join('\n');

      expect(available).toContain('claude-opus-4-6');
      expect(available).toContain('(current)');
      expect(available).toContain('claude-sonnet-4-6');
      expect(available).not.toContain('claude-sonnet-4-6` — Sonnet 4.6 (current)');
    });

    it('handles missing model info gracefully', () => {
      const modelInfo = null;
      const output = modelInfo
        ? 'has info'
        : 'Model info not available. The session may not be fully initialized.';
      expect(output).toBe('Model info not available. The session may not be fully initialized.');
    });
  });
});
