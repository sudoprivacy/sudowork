/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { emitter } from '@/renderer/utils/emitter';

describe('skills.changed event', () => {
  let listener: () => void;

  beforeEach(() => {
    listener = vi.fn();
    emitter.on('skills.changed', listener);
  });

  afterEach(() => {
    emitter.off('skills.changed', listener);
  });

  it('is emitted when explicitly triggered', () => {
    emitter.emit('skills.changed');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports multiple listeners', () => {
    const listener2 = vi.fn();
    emitter.on('skills.changed', listener2);
    emitter.emit('skills.changed');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
    emitter.off('skills.changed', listener2);
  });

  it('does not trigger after listener is removed', () => {
    emitter.off('skills.changed', listener);
    emitter.emit('skills.changed');
    expect(listener).not.toHaveBeenCalled();
  });

  it('can be triggered multiple times', () => {
    emitter.emit('skills.changed');
    emitter.emit('skills.changed');
    emitter.emit('skills.changed');
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
