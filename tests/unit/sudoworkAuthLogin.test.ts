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
        },
      })
    ).toEqual({
      id: 'u1',
      nickname: 'tester',
      sudorouter_key: 'router-key',
      model_service_url: 'https://hk.sudorouter.ai/v1',
      models: ['gemini-3-flash-preview', 'claude-sonnet-4'],
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
