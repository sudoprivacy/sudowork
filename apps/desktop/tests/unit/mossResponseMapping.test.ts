import { convertMossMessagesToTMessages } from '@sudowork/common/chatLib';
import { describe, expect, it } from 'vitest';

import { extractTextFromContent, isUserAbortError, mossControlRequestToConfirmation, mossFrameToResponses, type MossResponseCtx } from '@sudowork/common/mossResponse';

// Deterministic ctx so assertions can pin msg_id fallbacks.
let counter = 0;
function makeCtx(overrides: Partial<MossResponseCtx> = {}): MossResponseCtx {
  counter = 0;
  return {
    sessionId: 'sess-1',
    nextMsgId: () => `gen-${++counter}`,
    ...overrides,
  };
}

describe('mossFrameToResponses', () => {
  it('returns [] for stateful / effectful frames (caller owns them)', () => {
    for (const type of ['hello', 'control_response', 'control_request']) {
      expect(mossFrameToResponses({ type }, makeCtx())).toEqual([]);
    }
  });

  it('returns [] for unknown / caller-owned frame types and non-objects', () => {
    expect(mossFrameToResponses({ type: 'user' }, makeCtx())).toEqual([]);
    expect(mossFrameToResponses(null, makeCtx())).toEqual([]);
    expect(mossFrameToResponses('nope' as unknown as object, makeCtx())).toEqual([]);
  });

  describe('result', () => {
    it('emits error + finish for a genuine error result', () => {
      const out = mossFrameToResponses({ type: 'result', is_error: true, errors: ['boom', 'bang'], subtype: 'error_x', duration_ms: 12, total_cost_usd: 0.5, usage: { output: 3 }, num_turns: 2 }, makeCtx());
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ type: 'error', data: 'boom\nbang' });
      expect(out[1]).toMatchObject({ type: 'finish', data: { subtype: 'error_x', duration_ms: 12, total_cost_usd: 0.5, num_turns: 2, isUserAbort: false } });
    });

    it('suppresses the error message when the error is a user abort, still emits finish', () => {
      const out = mossFrameToResponses({ type: 'result', is_error: true, result_type: 'user', result: 'Request was aborted' }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'finish', data: { isUserAbort: true } });
    });

    it('emits only finish for a clean result', () => {
      const out = mossFrameToResponses({ type: 'result', subtype: 'success', duration_ms: 5 }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'finish', data: { subtype: 'success', isUserAbort: false } });
    });
  });

  describe('system', () => {
    it('maps init to acp_model_info and strips the proxy/ prefix for the label', () => {
      const out = mossFrameToResponses({ type: 'system', subtype: 'init', model: 'proxy/gpt-5.5' }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'acp_model_info', data: { currentModelId: 'proxy/gpt-5.5', currentModelLabel: 'gpt-5.5', canSwitch: false } });
    });

    it('maps model_changed too and leaves an unprefixed model untouched', () => {
      const out = mossFrameToResponses({ type: 'system', subtype: 'model_changed', model: 'claude-opus-4-8' }, makeCtx());
      expect(out[0]).toMatchObject({ type: 'acp_model_info', data: { currentModelId: 'claude-opus-4-8', currentModelLabel: 'claude-opus-4-8' } });
    });

    it('ignores non-init/model_changed system subtypes', () => {
      expect(mossFrameToResponses({ type: 'system', subtype: 'other' }, makeCtx())).toEqual([]);
    });
  });

  describe('tool_use', () => {
    it('maps AskUserQuestion to acp_question carrying options + _request_id', () => {
      const out = mossFrameToResponses({ type: 'tool_use', name: 'AskUserQuestion', tool_use_id: 'tu-1', _request_id: 'req-9', input: { question: 'Pick one', description: 'why', options: ['a', 'b', 3] } }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'acp_question', msg_id: 'tu-1', data: { question: 'Pick one', intro: 'why', options: ['a', 'b'], answered: false, _request_id: 'req-9' } });
      // conversationId defaults to '' (desktop callers don't pass ctx.conversationId)
      expect(out[0].data).toMatchObject({ conversationId: '' });
    });

    it('stamps the acp_question conversationId from ctx.conversationId (web passes sessionId)', () => {
      const out = mossFrameToResponses({ type: 'tool_use', name: 'AskUserQuestion', tool_use_id: 'tu-q', input: { question: 'Q?' } }, makeCtx({ conversationId: 'conv-9' }));
      expect(out[0].data).toMatchObject({ conversationId: 'conv-9' });
    });

    it('maps a completed tool_use to a tool_call_update', () => {
      const out = mossFrameToResponses({ type: 'tool_use', name: 'Bash', tool_use_id: 'tu-2', status: 'completed' }, makeCtx());
      expect(out[0]).toMatchObject({ type: 'acp_tool_call', data: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tu-2', status: 'completed' } } });
    });

    it('maps a pending tool_use to a tool_call with parsed input', () => {
      const out = mossFrameToResponses({ type: 'tool_use', name: 'Bash', tool_use_id: 'tu-3', input: '{"cmd":"ls"}' }, makeCtx());
      expect(out[0]).toMatchObject({ type: 'acp_tool_call', data: { update: { sessionUpdate: 'tool_call', status: 'pending', title: 'Bash', rawInput: { cmd: 'ls' } } } });
    });
  });

  describe('tool_result', () => {
    it('keeps successful tool output attached to its original call', () => {
      const out = mossFrameToResponses({ type: 'tool_result', uuid: 'result-1', tool_use_id: 'tu-1', content: [{ type: 'text', text: 'actual file content' }], is_error: false }, makeCtx({ conversationId: 'conv-1' }));
      expect(out).toEqual([
        {
          type: 'acp_tool_call',
          msg_id: 'tu-1',
          conversation_id: 'conv-1',
          data: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tu-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'actual file content' } }] } },
        },
      ]);
    });

    it('renders failed tool output instead of a successful completion badge', () => {
      const out = mossFrameToResponses({ type: 'tool_result', tool_use_id: 'tu-2', content: 'FileNotFound: workspace/proof.txt', is_error: true }, makeCtx());
      expect(out[0]).toMatchObject({ msg_id: 'tu-2', data: { update: { status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'FileNotFound: workspace/proof.txt' } }] } } });
    });

    it('retains empty successful output and ignores results without a call id', () => {
      expect(mossFrameToResponses({ type: 'tool_result', tool_use_id: 'tu-empty', content: '', is_error: false }, makeCtx())[0]).toMatchObject({ data: { update: { status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '' } }] } } });
      expect(mossFrameToResponses({ type: 'tool_result', uuid: 'orphan-result', content: 'orphan' }, makeCtx())).toEqual([]);
    });
  });

  describe('assistant', () => {
    it('preserves spaces and newlines between streamed text fragments', () => {
      const ctx = makeCtx({ conversationId: 'conv-1' });
      const chunks = ['The', ' ', 'file', '\n', 'exists.'];
      const responses = chunks.flatMap((text) => mossFrameToResponses({ type: 'assistant', uuid: 'answer-1', delta: true, message: { content: [{ type: 'text', text }] } }, ctx));
      expect(responses.map((response) => response.data).join('')).toBe('The file\nexists.');
      expect(responses.every((response) => response.msg_id === 'answer-1' && response.conversation_id === 'conv-1')).toBe(true);
      expect(mossFrameToResponses({ type: 'assistant', message: { content: [{ type: 'text', text: '  ' }] } }, ctx)).toEqual([]);
    });

    it('maps thinking / text blocks to thought / content and skips abort-related text', () => {
      const out = mossFrameToResponses(
        {
          type: 'assistant',
          uuid: 'a-1',
          message: {
            content: [
              { type: 'thinking', thinking: 'hmm' },
              { type: 'text', text: 'hello world' },
              { type: 'text', text: 'Request interrupted by user' },
            ],
          },
        },
        makeCtx()
      );
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ type: 'thought', data: { subject: 'Thinking', description: 'hmm' } });
      expect(out[1]).toMatchObject({ type: 'content', data: 'hello world' });
    });

    it('maps a tool_use content block to acp_tool_call', () => {
      const out = mossFrameToResponses({ type: 'assistant', uuid: 'a-2', message: { content: [{ type: 'tool_use', id: 'blk-1', name: 'Read', input: { path: '/x' } }] } }, makeCtx());
      expect(out[0]).toMatchObject({ type: 'acp_tool_call', msg_id: 'blk-1', data: { update: { toolCallId: 'blk-1', title: 'Read', rawInput: { path: '/x' } } } });
    });

    it('maps an assistant error to an error message', () => {
      const out = mossFrameToResponses({ type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: 'rate limited' }] } }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'error', data: 'rate limited' });
    });

    it('maps a non-array content payload to a single content message', () => {
      const out = mossFrameToResponses({ type: 'assistant', uuid: 'a-3', message: { content: 'plain string' } }, makeCtx());
      expect(out[0]).toMatchObject({ type: 'content', data: 'plain string' });
    });
  });

  describe('tool_progress / summaries / streamlined', () => {
    it('maps tool_progress to an in_progress tool_call_update with elapsed time', () => {
      const out = mossFrameToResponses({ type: 'tool_progress', tool_use_id: 'tp-1', elapsed_time_seconds: 4 }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: 'acp_tool_call',
        msg_id: 'tp-1',
        data: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tp-1', status: 'in_progress', content: [{ type: 'content', content: { type: 'text', text: 'Executing... (4s)' } }] } },
      });
    });

    it('maps tool_use_summary to a [Tool Summary] content message', () => {
      const out = mossFrameToResponses({ type: 'tool_use_summary', uuid: 'sum-1', summary: 'ran 3 tests' }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'content', msg_id: 'sum-1', data: '[Tool Summary] ran 3 tests' });
    });

    it('maps streamlined_text to content and drops blank text', () => {
      const out = mossFrameToResponses({ type: 'streamlined_text', uuid: 'st-1', text: 'streaming chunk' }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'content', msg_id: 'st-1', data: 'streaming chunk' });

      expect(mossFrameToResponses({ type: 'streamlined_text', uuid: 'st-2', text: '   ' }, makeCtx())).toEqual([]);
    });

    it('maps streamlined_tool_use_summary to a [Tool Summary] content message', () => {
      const out = mossFrameToResponses({ type: 'streamlined_tool_use_summary', uuid: 'sts-1', tool_summary: 'edited file.ts' }, makeCtx());
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'content', msg_id: 'sts-1', data: '[Tool Summary] edited file.ts' });
    });
  });

  it('stamps conversation_id from ctx (default "") and prefers frame.uuid for msg_id', () => {
    const withUuid = mossFrameToResponses({ type: 'result', uuid: 'u-1', subtype: 'success' }, makeCtx());
    expect(withUuid[0].msg_id).toBe('u-1');
    expect(withUuid[0].conversation_id).toBe('');

    const withConv = mossFrameToResponses({ type: 'result', subtype: 'success' }, makeCtx({ conversationId: 'conv-7' }));
    expect(withConv[0].conversation_id).toBe('conv-7');
    expect(withConv[0].msg_id).toBe('gen-1');
  });
});

describe('shared helpers', () => {
  it('isUserAbortError detects abort signals across shapes', () => {
    expect(isUserAbortError({ result_type: 'user' })).toBe(true);
    expect(isUserAbortError({ errors: ['AbortError: x'] })).toBe(true);
    expect(isUserAbortError({ result: 'aborted by user' })).toBe(true);
    expect(isUserAbortError({ stop_reason: 'user_abort' })).toBe(true);
    expect(isUserAbortError({ result: 'ok' })).toBe(false);
  });

  it('extractTextFromContent handles strings and text-block arrays', () => {
    expect(extractTextFromContent('raw')).toBe('raw');
    expect(extractTextFromContent([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('ab');
    expect(extractTextFromContent({ nope: true })).toBe('');
  });
});

describe('mossControlRequestToConfirmation', () => {
  it('maps a control_request payload with options onto IConfirmation', () => {
    const confirmation = mossControlRequestToConfirmation(
      {
        title: 'Run command',
        rawInput: { cmd: 'ls' },
        options: [
          { name: 'Allow', optionId: 'allow_once' },
          { name: 'Reject', optionId: 'reject_once' },
        ],
      },
      'req-1'
    );
    expect(confirmation).toEqual({
      id: 'req-1',
      callId: 'req-1',
      title: 'Run command',
      description: '{"cmd":"ls"}',
      options: [
        { label: 'Allow', value: 'allow_once' },
        { label: 'Reject', value: 'reject_once' },
      ],
    });
  });

  it('falls back to tool_name title, stringified input and default options', () => {
    const confirmation = mossControlRequestToConfirmation({ tool_name: 'Bash', input: { cmd: 'pwd' } }, 'req-2');
    expect(confirmation.title).toBe('Bash');
    expect(confirmation.description).toBe('{"cmd":"pwd"}');
    expect(confirmation.options).toEqual([
      { label: 'Allow', value: 'allow_once' },
      { label: 'Always Allow', value: 'allow_always' },
      { label: 'Reject', value: 'reject_once' },
    ]);
  });

  it('stringifies empty input as {} and keeps the default title', () => {
    const confirmation = mossControlRequestToConfirmation({}, 'req-3');
    expect(confirmation.title).toBe('Permission Required');
    expect(confirmation.description).toBe('{}');
  });
});

describe('validated cloud artifact delivery', () => {
  it('renders only this session’s generated final files, including names with spaces', () => {
    const ctx = { sessionId: 'cloud-session', nextMsgId: () => 'message' };
    const base = { sessionId: 'cloud-session', origin: 'generated', updatedAt: 1, size: 2 };
    const result = mossFrameToResponses(
      {
        type: 'artifacts',
        v: 1,
        workspace: '/workspace',
        records: [
          { ...base, relativePath: '报价 数据.json', intent: 'final' },
          { ...base, relativePath: '.drafts/temp.json', intent: 'draft' },
          { ...base, relativePath: 'unknown.json', intent: 'unknown' },
          { ...base, relativePath: 'bad.json', intent: 'final', error: 'Invalid JSON' },
          { ...base, relativePath: 'input.json', intent: 'final', origin: 'existing' },
          { ...base, relativePath: '../outside.txt', intent: 'final' },
          { ...base, relativePath: 'other.txt', intent: 'final', sessionId: 'other' },
        ],
      },
      ctx
    );
    expect(result).toHaveLength(1);
    const payload = JSON.parse(String(result[0].data).split('[[NEXUS_GENERATED_FILES]]')[1]);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].path).toBe('/workspace/报价 数据.json');
  });
});

it('restores validated artifact cards from persisted Moss history', () => {
  const result = convertMossMessagesToTMessages([{ type: 'artifacts', v: 1, workspace: '/workspace', uuid: 'artifact-1', records: [{ sessionId: 's', origin: 'generated', intent: 'final', relativePath: '结果.json', updatedAt: 1 }] }], 'conversation', 's');
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({ type: 'text', msg_id: 'artifact-1', content: { content: expect.stringContaining('[[NEXUS_GENERATED_FILES]]') } });
});
