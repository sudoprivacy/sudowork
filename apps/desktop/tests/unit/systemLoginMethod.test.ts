import { describe, expect, it } from 'vitest';
import { resolveAuthMethods } from '@renderer/hooks/useSystemLoginMethod';

describe('resolveAuthMethods', () => {
  it('uses the ordered capability list returned by Moss', () => {
    expect(
      resolveAuthMethods({
        login_method: 0,
        auth_methods: ['password', 'phone', 'api_key', 'password'],
      })
    ).toEqual(['password', 'phone', 'api_key']);
  });

  it('keeps password and API Key available for a legacy phone deployment', () => {
    expect(resolveAuthMethods({ login_method: 0 })).toEqual(['phone', 'password', 'api_key']);
  });

  it('maps legacy SSO and password deployments without hiding API Key login', () => {
    expect(resolveAuthMethods({ login_method: 1 })).toEqual(['password', 'api_key']);
    expect(resolveAuthMethods({ login_method: 2 })).toEqual(['sso', 'password', 'api_key']);
  });
});
