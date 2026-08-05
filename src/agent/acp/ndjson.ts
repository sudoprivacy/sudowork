/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { StringDecoder } from 'string_decoder';
import type { AcpMessage } from '@/types/acpTypes';

/**
 * Incremental NDJSON → AcpMessage parser, shared by the stdio and gRPC readers.
 *
 * StringDecoder holds an incomplete trailing multibyte sequence across chunks,
 * so a UTF-8 char split between two reads is never corrupted; only complete
 * newline-terminated lines are parsed, the trailing partial is retained for the
 * next chunk. Non-JSON and blank lines are skipped.
 */
export class NdjsonParser {
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';

  /** Feed a byte chunk; return the complete ACP messages it completes. */
  push(chunk: Buffer): AcpMessage[] {
    this.buffer += this.decoder.write(chunk);
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    const out: AcpMessage[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AcpMessage);
      } catch {
        // non-JSON line — ignore
      }
    }
    return out;
  }
}
