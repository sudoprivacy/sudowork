/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  encodeChatId,
  parseCallbackXml,
  parseChatId,
  splitMarkdown,
  toSendDescriptor,
  toUnifiedIncomingMessage,
  WECOM_APP_MSG_LIMIT,
} from '@/channels/plugins/wecom-app/WeComAppAdapter';

describe('WeComAppAdapter', () => {
  describe('encodeChatId / parseChatId', () => {
    it('encodes single-user chat as {agentId}_{userid}', () => {
      expect(encodeChatId('10002', 'zhuyx')).toBe('10002_zhuyx');
    });

    it('encodes group chat as {agentId}_chat_{chatid}', () => {
      expect(encodeChatId('10002', 'zhuyx', 'abc_chatid')).toBe('10002_chat_abc_chatid');
    });

    it('parses single-user chatId', () => {
      expect(parseChatId('10002_zhuyx')).toEqual({ agentId: '10002', type: 'user', id: 'zhuyx' });
    });

    it('parses group chatId', () => {
      expect(parseChatId('10002_chat_abc_chatid')).toEqual({ agentId: '10002', type: 'group', id: 'abc_chatid' });
    });

    it('parses userid containing underscores as user type', () => {
      // user.name with underscores — the regex takes first `_` as agent boundary
      const parsed = parseChatId('10002_user.with_underscore');
      expect(parsed.agentId).toBe('10002');
      expect(parsed.type).toBe('user');
      expect(parsed.id).toBe('user.with_underscore');
    });
  });

  describe('parseCallbackXml', () => {
    it('parses a text message envelope', () => {
      const xml = `
        <xml>
          <ToUserName><![CDATA[wxcorpid1]]></ToUserName>
          <FromUserName><![CDATA[zhuyx]]></FromUserName>
          <CreateTime>1700000000</CreateTime>
          <MsgType><![CDATA[text]]></MsgType>
          <Content><![CDATA[hello 你好]]></Content>
          <MsgId>1234567890</MsgId>
          <AgentID>10002</AgentID>
        </xml>
      `;
      const parsed = parseCallbackXml(xml);
      expect(parsed.ToUserName).toBe('wxcorpid1');
      expect(parsed.FromUserName).toBe('zhuyx');
      expect(parsed.MsgType).toBe('text');
      expect(parsed.Content).toBe('hello 你好');
      expect(parsed.AgentID).toBe('10002');
    });

    it('parses an image payload with MediaId', () => {
      const xml = `
        <xml>
          <FromUserName><![CDATA[zhuyx]]></FromUserName>
          <MsgType><![CDATA[image]]></MsgType>
          <PicUrl><![CDATA[https://example.com/pic.jpg]]></PicUrl>
          <MediaId><![CDATA[MEDIA_123]]></MediaId>
          <AgentID>10002</AgentID>
          <CreateTime>1700000001</CreateTime>
        </xml>
      `;
      const parsed = parseCallbackXml(xml);
      expect(parsed.MsgType).toBe('image');
      expect(parsed.MediaId).toBe('MEDIA_123');
      expect(parsed.PicUrl).toBe('https://example.com/pic.jpg');
    });

    it('parses an approval event with nested ApprovalInfo', () => {
      const xml = `
        <xml>
          <ToUserName><![CDATA[wxcorpid1]]></ToUserName>
          <FromUserName><![CDATA[sys]]></FromUserName>
          <CreateTime>1700000002</CreateTime>
          <MsgType><![CDATA[event]]></MsgType>
          <Event><![CDATA[sys_approval_change]]></Event>
          <AgentID>10002</AgentID>
          <ApprovalInfo>
            <SpNo><![CDATA[202403150001]]></SpNo>
            <SpName><![CDATA[请假申请]]></SpName>
            <SpStatus>2</SpStatus>
          </ApprovalInfo>
        </xml>
      `;
      const parsed = parseCallbackXml(xml);
      expect(parsed.Event).toBe('sys_approval_change');
      const info = parsed.ApprovalInfo as Record<string, unknown>;
      expect(info).toBeTruthy();
      expect(info.SpNo).toBe('202403150001');
      expect(info.SpStatus).toBe('2');
      expect(info.SpName).toBe('请假申请');
    });
  });

  describe('toUnifiedIncomingMessage', () => {
    it('produces a text incoming message with proper chatId + platform', () => {
      const xml = parseCallbackXml(`
        <xml>
          <FromUserName><![CDATA[zhuyx]]></FromUserName>
          <CreateTime>1700000000</CreateTime>
          <MsgType><![CDATA[text]]></MsgType>
          <Content><![CDATA[hi]]></Content>
          <MsgId>11111</MsgId>
          <AgentID>10002</AgentID>
        </xml>
      `);
      const msg = toUnifiedIncomingMessage(xml);
      expect(msg).not.toBeNull();
      expect(msg!.platform).toBe('wecom-app');
      expect(msg!.chatId).toBe('10002_zhuyx');
      expect(msg!.content.type).toBe('text');
      expect(msg!.content.text).toBe('hi');
      expect(msg!.user.id).toBe('zhuyx');
      expect(msg!.timestamp).toBe(1700000000 * 1000);
    });

    it('prefers the local decrypted path for image attachments when provided', () => {
      const xml = parseCallbackXml(`
        <xml>
          <FromUserName><![CDATA[zhuyx]]></FromUserName>
          <MsgType><![CDATA[image]]></MsgType>
          <MediaId><![CDATA[M1]]></MediaId>
          <AgentID>10002</AgentID>
          <CreateTime>1700000000</CreateTime>
        </xml>
      `);
      const msg = toUnifiedIncomingMessage(xml, { mediaLocalPath: '/tmp/wecom-app/abc.jpg' });
      expect(msg!.content.type).toBe('photo');
      expect(msg!.content.attachments?.[0].fileId).toBe('/tmp/wecom-app/abc.jpg');
    });

    it('falls back to MediaId when no local path is supplied', () => {
      const xml = parseCallbackXml(`
        <xml>
          <FromUserName><![CDATA[zhuyx]]></FromUserName>
          <MsgType><![CDATA[file]]></MsgType>
          <MediaId><![CDATA[FILE_MEDIA]]></MediaId>
          <Title><![CDATA[report.pdf]]></Title>
          <AgentID>10002</AgentID>
          <CreateTime>1700000000</CreateTime>
        </xml>
      `);
      const msg = toUnifiedIncomingMessage(xml);
      expect(msg!.content.type).toBe('document');
      expect(msg!.content.attachments?.[0].fileId).toBe('FILE_MEDIA');
      expect(msg!.content.attachments?.[0].fileName).toBe('report.pdf');
    });

    it('returns null when FromUserName is missing', () => {
      const xml = parseCallbackXml(`
        <xml>
          <MsgType><![CDATA[text]]></MsgType>
          <Content><![CDATA[hi]]></Content>
        </xml>
      `);
      expect(toUnifiedIncomingMessage(xml)).toBeNull();
    });
  });

  describe('toSendDescriptor', () => {
    it('routes text messages through markdown', () => {
      const d = toSendDescriptor({ type: 'text', text: '<b>hello</b>' });
      expect(d.kind).toBe('markdown');
      if (d.kind === 'markdown') {
        // HTML should be converted to markdown shape, not left as raw tags
        expect(d.content).not.toMatch(/<b>/i);
      }
    });

    it('routes image messages with local source', () => {
      const d = toSendDescriptor({ type: 'image', imageUrl: '/tmp/pic.jpg' });
      expect(d).toEqual({ kind: 'image', source: '/tmp/pic.jpg', sourceKind: 'local' });
    });

    it('routes image messages with remote source', () => {
      const d = toSendDescriptor({ type: 'image', imageUrl: 'https://example.com/pic.jpg' });
      expect(d).toEqual({ kind: 'image', source: 'https://example.com/pic.jpg', sourceKind: 'remote' });
    });

    it('routes file messages preserving fileName', () => {
      const d = toSendDescriptor({ type: 'file', fileUrl: '/tmp/report.pdf', fileName: 'report.pdf' });
      expect(d).toEqual({ kind: 'file', source: '/tmp/report.pdf', sourceKind: 'local', fileName: 'report.pdf' });
    });
  });

  describe('splitMarkdown', () => {
    it('returns single chunk when under the limit', () => {
      expect(splitMarkdown('short')).toEqual(['short']);
    });

    it('splits long text into multiple chunks under the limit', () => {
      const text = 'a'.repeat(WECOM_APP_MSG_LIMIT * 2 + 50);
      const chunks = splitMarkdown(text);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(WECOM_APP_MSG_LIMIT);
      }
      expect(chunks.join('').replace(/\s/g, '')).toBe(text);
    });

    it('prefers splitting at a newline boundary when available', () => {
      // Place a newline near the end of the first chunk so it becomes the split
      const line1 = 'a'.repeat(100) + '\n';
      const line2 = 'b'.repeat(60);
      const chunks = splitMarkdown(line1 + line2, 120);
      expect(chunks.length).toBe(2);
      // First chunk should end right before/at the newline (trimmed)
      expect(chunks[0].endsWith('a')).toBe(true);
      expect(chunks[1].startsWith('b')).toBe(true);
    });
  });
});
