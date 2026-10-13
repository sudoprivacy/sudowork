import { describe, expect, it } from 'vitest';
import { loginReturnPath } from '../../../../packages/common/src/loginReturnPath';

describe('Agent workbench login return', () => {
  it('keeps the selected conversation after login', () => {
    expect(loginReturnPath({ returnTo: '/conversation/4bd3b2c7-566c-4ac6-a950-5f228cac21ca' })).toBe('/conversation/4bd3b2c7-566c-4ac6-a950-5f228cac21ca');
  });
  it('keeps the selected organization as a public identity hint', () => {
    expect(loginReturnPath({ returnTo: '/conversation/session-1?org_id=org-2' })).toBe('/conversation/session-1?org_id=org-2');
  });
  it.each(['/conversation/session?org_id=org-1&org_id=org-2', '/conversation/session?org_id=org-1&token=secret', '/conversation/session?org_id=..', '/conversation/session?org_id=https%3A%2F%2Fevil.example'])('refuses unsafe organization hints: %s', (returnTo) => {
    expect(loginReturnPath({ returnTo })).toBe('/guid');
  });
  it.each([null, undefined, {}, { returnTo: '//attacker.example' }, { returnTo: 'https://attacker.example' }, { returnTo: '/login' }, { returnTo: '/conversation/../settings' }, { returnTo: '/conversation/session?token=secret' }])('refuses an unsafe or unrelated return target: %j', (state) => {
    expect(loginReturnPath(state)).toBe('/guid');
  });
});
