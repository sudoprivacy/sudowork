/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { NdjsonParser } from '../../src/agent/acp/ndjson';

/** Build a JSON-RPC line the way both transports frame it. */
function line(obj: object): Buffer {
  return Buffer.from(JSON.stringify(obj) + '\n', 'utf-8');
}

describe('NdjsonParser', () => {
  it('parses one complete line into one message', () => {
    const p = new NdjsonParser();
    const msgs = p.push(line({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    expect(msgs).toEqual([{ jsonrpc: '2.0', id: 1, method: 'initialize' }]);
  });

  it('parses multiple lines in a single chunk', () => {
    const p = new NdjsonParser();
    const chunk = Buffer.concat([line({ id: 1 }), line({ id: 2 }), line({ id: 3 })]);
    const msgs = p.push(chunk);
    expect(msgs.map((m) => (m as { id: number }).id)).toEqual([1, 2, 3]);
  });

  it('holds a partial line until the newline arrives', () => {
    const p = new NdjsonParser();
    const full = JSON.stringify({ id: 7, method: 'session/prompt' }) + '\n';
    const split = Math.floor(full.length / 2);
    expect(p.push(Buffer.from(full.slice(0, split), 'utf-8'))).toEqual([]);
    const msgs = p.push(Buffer.from(full.slice(split), 'utf-8'));
    expect(msgs).toEqual([{ id: 7, method: 'session/prompt' }]);
  });

  it('reassembles a UTF-8 char split across two chunks (no corruption)', () => {
    const p = new NdjsonParser();
    // '中' is 3 bytes (E4 B8 AD); split them 2+1 across two reads.
    const bytes = line({ id: 9, text: '中' });
    const nl = bytes.indexOf(0x0a);
    const cut = bytes.indexOf(0xe4) + 2; // mid-multibyte-sequence, before the newline
    expect(cut).toBeLessThan(nl);
    expect(p.push(bytes.subarray(0, cut))).toEqual([]);
    const msgs = p.push(bytes.subarray(cut));
    expect(msgs).toEqual([{ id: 9, text: '中' }]);
  });

  it('skips blank lines and non-JSON lines without throwing', () => {
    const p = new NdjsonParser();
    const chunk = Buffer.from('\n' + 'not json\n' + JSON.stringify({ id: 5 }) + '\n', 'utf-8');
    const msgs = p.push(chunk);
    expect(msgs).toEqual([{ id: 5 }]);
  });

  it('keeps a JSON payload containing an embedded newline string intact', () => {
    const p = new NdjsonParser();
    // The newline inside the string is escaped as \n in JSON, so framing is safe.
    const msgs = p.push(line({ id: 3, text: 'line1\nline2' }));
    expect(msgs).toEqual([{ id: 3, text: 'line1\nline2' }]);
  });
});
