/**
 * 密码强度校验，规则与后端 `src/utils/password.ts` 完全一致（见第三方接口文档 §3/§4）。
 * 返回 i18n key（错误文案）或 null（校验通过）。注册与修改密码共用。
 */
export function validatePassword(pwd: string): string | null {
  if (!pwd) return 'login.pwdErrorEmpty';
  if (pwd.length < 8) return 'login.pwdErrorTooShort';
  if (pwd.length > 20) return 'login.pwdErrorTooLong';
  if (!/[A-Z]/.test(pwd)) return 'login.pwdErrorNoUpper';
  if (!/[a-z]/.test(pwd)) return 'login.pwdErrorNoLower';
  if (!/\d/.test(pwd)) return 'login.pwdErrorNoDigit';
  return null;
}
