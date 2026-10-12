import { describe, expect, it } from 'vitest';
import { loginReturnPath } from '../../../../packages/common/src/loginReturnPath';

describe('Agent workbench login return', () => {
  it('keeps the selected conversation after login', () => {
    expect(loginReturnPath({ returnTo: '/conversation/4bd3b2c7-566c-4ac6-a950-5f228cac21ca' })).toBe('/conversation/4bd3b2c7-566c-4ac6-a950-5f228cac21ca');
  });
  it.each([null, undefined, {}, { returnTo: '//attacker.example' }, { returnTo: 'https://attacker.example' }, { returnTo: '/login' }, { returnTo: '/conversation/../settings' }, { returnTo: '/conversation/session?token=secret' }])('refuses an unsafe or unrelated return target: %j', (state) => {
    expect(loginReturnPath(state)).toBe('/guid');
  });
});
