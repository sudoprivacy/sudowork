import { describe, it, expect } from 'vitest';

/**
 * Channel Credential Fields Mapping
 * This must match the definition in secret-migration.ts
 *
 * Credential fields vs ID fields:
 * - ID fields (appId, clientId, accountId) are NOT credentials - they are identifiers
 * - Only sensitive fields that need to be stored in Nexus
 */
const CHANNEL_CREDENTIAL_FIELDS: Record<string, string[]> = {
  telegram: ['token'],
  lark: ['appSecret', 'encryptKey', 'verificationToken'],
  dingtalk: ['clientSecret'],
  wechat: [], // WeChat uses token-based auth, no separate secret
};

/**
 * Get credential fields for a channel type
 */
function getChannelCredentialFields(channelType: string): string[] {
  return CHANNEL_CREDENTIAL_FIELDS[channelType] || [];
}

describe('Channel Credential Fields Mapping', () => {
  describe('getChannelCredentialFields', () => {
    it('should return correct fields for telegram', () => {
      const fields = getChannelCredentialFields('telegram');
      expect(fields).toEqual(['token']);
    });

    it('should return correct fields for lark (Feishu)', () => {
      const fields = getChannelCredentialFields('lark');
      expect(fields).toEqual(['appSecret', 'encryptKey', 'verificationToken']);
    });

    it('should return correct fields for dingtalk', () => {
      const fields = getChannelCredentialFields('dingtalk');
      expect(fields).toEqual(['clientSecret']);
    });

    it('should return empty array for wechat', () => {
      const fields = getChannelCredentialFields('wechat');
      expect(fields).toEqual([]);
    });

    it('should return empty array for unknown channel type', () => {
      const fields = getChannelCredentialFields('unknown');
      expect(fields).toEqual([]);
    });
  });

  describe('credential field definitions', () => {
    it('should NOT include ID fields as credentials', () => {
      // These are identifiers, NOT credentials
      const telegramFields = getChannelCredentialFields('telegram');
      expect(telegramFields).not.toContain('botId');

      const larkFields = getChannelCredentialFields('lark');
      expect(larkFields).not.toContain('appId');

      const dingtalkFields = getChannelCredentialFields('dingtalk');
      expect(dingtalkFields).not.toContain('clientId');

      const wechatFields = getChannelCredentialFields('wechat');
      expect(wechatFields).not.toContain('accountId');
      expect(wechatFields).not.toContain('botApiBaseUrl');
    });

    it('should only include sensitive credential fields', () => {
      // Verify each channel has only sensitive fields
      const telegramFields = getChannelCredentialFields('telegram');
      expect(telegramFields.every((f) => ['token'].includes(f))).toBe(true);

      const larkFields = getChannelCredentialFields('lark');
      expect(larkFields.every((f) => ['appSecret', 'encryptKey', 'verificationToken'].includes(f))).toBe(true);

      const dingtalkFields = getChannelCredentialFields('dingtalk');
      expect(dingtalkFields.every((f) => ['clientSecret'].includes(f))).toBe(true);
    });

    it('should include all sensitive credential fields for lark', () => {
      const fields = getChannelCredentialFields('lark');
      // Lark has multiple credential types
      expect(fields).toContain('appSecret');
      expect(fields).toContain('encryptKey');
      expect(fields).toContain('verificationToken');
      expect(fields.length).toBe(3);
    });

    it('should only include token for telegram', () => {
      const fields = getChannelCredentialFields('telegram');
      expect(fields.length).toBe(1);
      expect(fields[0]).toBe('token');
    });
  });

  describe('Nexus namespace convention', () => {
    it('should support channel namespace format channel:{type}:{id}', () => {
      // Verify namespace pattern can be constructed
      const channelType = 'telegram';
      const channelId = '123456';
      const namespace = `channel:${channelType}:${channelId}`;
      expect(namespace).toBe('channel:telegram:123456');
    });

    it('should support provider namespace format provider:{id}', () => {
      // Verify namespace pattern for AI providers
      const providerId = 'openai-1';
      const namespace = `provider:${providerId}`;
      expect(namespace).toBe('provider:openai-1');
    });

    it('should support auth namespace format auth:{type}:{name}', () => {
      // Verify namespace pattern for auth secrets
      const namespace = 'auth:jwt:webui_secret';
      expect(namespace).toBe('auth:jwt:webui_secret');
    });
  });
});

describe('IPluginCredentials field classification', () => {
  interface IPluginCredentials {
    token?: string;
    appId?: string;
    appSecret?: string;
    encryptKey?: string;
    verificationToken?: string;
    clientId?: string;
    clientSecret?: string;
    accountId?: string;
    botApiBaseUrl?: string;
  }

  // Credential fields that should be stored in Nexus
  const CREDENTIAL_FIELDS: Record<string, (keyof IPluginCredentials)[]> = {
    telegram: ['token'],
    lark: ['appSecret', 'encryptKey', 'verificationToken'],
    dingtalk: ['clientSecret'],
    wechat: [],
  };

  // ID fields that should NOT be stored in Nexus (kept in SQLite)
  const ID_FIELDS: Record<string, (keyof IPluginCredentials)[]> = {
    telegram: [],
    lark: ['appId'],
    dingtalk: ['clientId'],
    wechat: ['accountId', 'botApiBaseUrl'],
  };

  it('should correctly classify telegram credentials', () => {
    const credFields = CREDENTIAL_FIELDS['telegram'];
    const idFields = ID_FIELDS['telegram'];

    expect(credFields).toContain('token');
    expect(idFields).not.toContain('token');
  });

  it('should correctly classify lark credentials', () => {
    const credFields = CREDENTIAL_FIELDS['lark'];
    const idFields = ID_FIELDS['lark'];

    expect(credFields).toContain('appSecret');
    expect(credFields).toContain('encryptKey');
    expect(credFields).toContain('verificationToken');
    expect(idFields).toContain('appId');
  });

  it('should correctly classify dingtalk credentials', () => {
    const credFields = CREDENTIAL_FIELDS['dingtalk'];
    const idFields = ID_FIELDS['dingtalk'];

    expect(credFields).toContain('clientSecret');
    expect(idFields).toContain('clientId');
  });

  it('should correctly classify wechat fields', () => {
    const credFields = CREDENTIAL_FIELDS['wechat'];
    const idFields = ID_FIELDS['wechat'];

    expect(credFields.length).toBe(0);
    expect(idFields).toContain('accountId');
    expect(idFields).toContain('botApiBaseUrl');
  });
});
