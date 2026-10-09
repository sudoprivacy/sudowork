import { describe, expect, it } from 'vitest';
import { extractLoginSudoclawPayload, mergeLoginUserData } from '@/common/sudoworkAuthLogin';

describe('sudoworkAuthLogin', () => {
  it('merges sudoclaw login fields from login response root data into user data', () => {
    expect(
      mergeLoginUserData({
        data: {
          user: {
            id: 'u1',
            nickname: 'tester',
          },
          sudorouter_key: 'router-key',
          model_service_url: 'https://hk.sudorouter.ai/v1',
          models: ['gemini-3-flash-preview', 'claude-sonnet-4'],
          scode_auto_model: 'gpt-5.6',
        },
      })
    ).toEqual({
      id: 'u1',
      nickname: 'tester',
      sudorouter_key: 'router-key',
      model_service_url: 'https://hk.sudorouter.ai/v1',
      models: ['gemini-3-flash-preview', 'claude-sonnet-4'],
      scode_auto_model: 'gpt-5.6',
    });
  });

  it('extracts sudoclaw login payload from alternate model list fields', () => {
    expect(
      extractLoginSudoclawPayload({
        data: {
          user: {
            id: 'u1',
            sudorouter_key: 'user-key',
            model_service_url: 'https://user.example.com/v1',
          },
          available_models: ['gemini-3-flash-preview'],
        },
      })
    ).toEqual({
      sudorouterKey: 'user-key',
      modelServiceUrl: 'https://user.example.com/v1',
      models: ['gemini-3-flash-preview'],
    });
  });

  it('extracts the server-configured scode auto model from login response data', () => {
    expect(
      extractLoginSudoclawPayload({
        data: {
          user: {
            id: 'u1',
            sudorouter_key: 'user-key',
            model_service_url: 'https://user.example.com/v1',
            models: ['gemini-3-flash-preview'],
            scode_auto_model: 'gpt-5.6',
          },
        },
      })
    ).toEqual({
      sudorouterKey: 'user-key',
      modelServiceUrl: 'https://user.example.com/v1',
      models: ['gemini-3-flash-preview'],
      scodeAutoModel: 'gpt-5.6',
    });
  });

  it('uses the server-configured scode auto model when the login model list is empty', () => {
    expect(
      extractLoginSudoclawPayload({
        data: {
          user: {
            id: 'u1',
            sudorouter_key: 'user-key',
            model_service_url: 'https://user.example.com/v1',
            models: [],
            scode_auto_model: 'gpt-5.5',
          },
        },
      })
    ).toEqual({
      sudorouterKey: 'user-key',
      modelServiceUrl: 'https://user.example.com/v1',
      models: ['gpt-5.5'],
      scodeAutoModel: 'gpt-5.5',
    });
  });

  it('returns null when login response does not contain a usable sudoclaw payload', () => {
    expect(
      extractLoginSudoclawPayload({
        data: {
          user: {
            id: 'u1',
          },
        },
      })
    ).toBeNull();
  });
});
