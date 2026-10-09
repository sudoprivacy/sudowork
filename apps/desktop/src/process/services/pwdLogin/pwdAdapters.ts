/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Known-site form-fill adapters for pwd_login.
 *
 * v2 spec §3.f form-fill strategy order:
 *   1st — pwd_adapters.ts known-site map (this file)
 *   2nd — generic DOM heuristic (input[type=password] + nearest preceding user/email input)
 *   3rd — return login_form_not_found → agent can fall back to ax_tree inspection
 *
 * Phase-1 targets ~10 sites that Ethan actually uses. Add more as needed.
 * Entries are matched by `title` (primary, case-insensitive) or `domain`
 * (fallback if the title→entry lookup fails). Title is authoritative
 * because that's the primary key in nexus PasswordVaultService.
 */

export type PwdAdapterStrategy = 'two_step' | 'single_step';

export interface PwdAdapter {
  /** Human label, lowercased for lookup */
  title: string;
  /** Canonical login URL (used when caller doesn't supply url override) */
  loginUrl: string;
  /** Domain(s) this adapter covers — used for fallback matching if title miss */
  domains: string[];
  /** CSS selector for the username/email field */
  usernameSelector: string;
  /** CSS selector for the password field */
  passwordSelector: string;
  /** CSS selector for the submit button (or form submit equivalent) */
  submitSelector: string;
  /** Optional CSS selector for an image-captcha input field (e.g. `#txtValCode`). */
  captchaSelector?: string;
  /** Optional CSS selector for the captcha `<img>` element (screenshotted + read by a vision model). */
  captchaImageSelector?: string;
  /**
   * `single_step`: username + password visible on same page.
   * `two_step`: username page, then password page. For two_step, the caller
   * fills username first, clicks submit, waits for the password page, then
   * fills password. Phase-1 only handles single_step; two_step entries are
   * registered but Phase-1 returns `login_form_not_found` if matched.
   */
  strategy: PwdAdapterStrategy;
}

/**
 * Day-1 known sites. Selectors verified as of 2026-04-22; may drift.
 * When a site UI changes, update the entry here (adapter_error will fire
 * if selectors miss after form-fill).
 */
const ADAPTERS: PwdAdapter[] = [
  {
    title: 'github',
    loginUrl: 'https://github.com/login',
    domains: ['github.com'],
    usernameSelector: 'input#login_field',
    passwordSelector: 'input#password',
    submitSelector: 'input[name="commit"]',
    strategy: 'single_step',
  },
  {
    title: 'google',
    loginUrl: 'https://accounts.google.com/signin',
    domains: ['accounts.google.com', 'google.com'],
    usernameSelector: 'input[type="email"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button[type="submit"], #passwordNext button, #identifierNext button',
    strategy: 'two_step',
  },
  {
    title: 'twitter',
    loginUrl: 'https://twitter.com/i/flow/login',
    domains: ['twitter.com', 'x.com'],
    usernameSelector: 'input[autocomplete="username"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'div[data-testid="LoginForm_Login_Button"]',
    strategy: 'two_step',
  },
  {
    title: 'zhihu',
    loginUrl: 'https://www.zhihu.com/signin',
    domains: ['zhihu.com'],
    usernameSelector: 'input[name="username"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'button[type="submit"].SignFlow-submitButton',
    strategy: 'single_step',
  },
  {
    title: 'bilibili',
    loginUrl: 'https://passport.bilibili.com/login',
    domains: ['bilibili.com', 'passport.bilibili.com'],
    usernameSelector: 'input.tb-username, input[placeholder*="邮箱"]',
    passwordSelector: 'input.tb-password, input[type="password"]',
    submitSelector: 'a.btn-login, button[type="submit"]',
    strategy: 'single_step',
  },
  {
    title: 'linear',
    loginUrl: 'https://linear.app/login',
    domains: ['linear.app'],
    usernameSelector: 'input[name="email"], input[type="email"]',
    passwordSelector: 'input[name="password"], input[type="password"]',
    submitSelector: 'button[type="submit"]',
    strategy: 'two_step',
  },
  {
    title: 'notion',
    loginUrl: 'https://www.notion.so/login',
    domains: ['notion.so'],
    usernameSelector: 'input#notion-email-input-1, input[type="email"]',
    passwordSelector: 'input#notion-password-input-2, input[type="password"]',
    submitSelector: 'div[role="button"]:has-text("Continue with password"), button[type="submit"]',
    strategy: 'two_step',
  },
  {
    title: 'figma',
    loginUrl: 'https://www.figma.com/login',
    domains: ['figma.com'],
    usernameSelector: 'input[name="email"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'button[type="submit"]',
    strategy: 'single_step',
  },
  {
    title: 'slack',
    loginUrl: 'https://slack.com/signin',
    domains: ['slack.com'],
    usernameSelector: 'input#email',
    passwordSelector: 'input#password',
    submitSelector: 'button#signin_btn',
    strategy: 'single_step',
  },
  {
    title: 'discord',
    loginUrl: 'https://discord.com/login',
    domains: ['discord.com'],
    usernameSelector: 'input[name="email"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'button[type="submit"]',
    strategy: 'single_step',
  },
  {
    // 易道会员后台 — F1 first-light test site. Has a 4-digit image captcha solved
    // by the vision model (see feedback_f1_captcha_vision_not_ocr). The password
    // field is type=text that switches to password on focus; the submit button
    // runs client-side encryption in Login_Submit() on click.
    title: 'yidao',
    loginUrl: 'http://yidao.vip5968.net/login.aspx?Code=999',
    domains: ['yidao.vip5968.net'],
    usernameSelector: '#txtAccount',
    passwordSelector: '#txtPassword',
    submitSelector: '#btnSubmit',
    captchaSelector: '#txtValCode',
    captchaImageSelector: '#Login_ValImg',
    strategy: 'single_step',
  },
];

/** Case-insensitive title lookup. Primary matching path. */
export function findAdapterByTitle(title: string): PwdAdapter | undefined {
  const needle = title.trim().toLowerCase();
  return ADAPTERS.find((a) => a.title === needle);
}

/** Domain lookup. Fallback when title miss but caller supplied url / tab context. */
export function findAdapterByDomain(domain: string): PwdAdapter | undefined {
  const needle = domain.trim().toLowerCase();
  return ADAPTERS.find((a) => a.domains.some((d) => needle === d || needle.endsWith('.' + d)));
}

/** All registered adapters (for debug / test listing). */
export function listAdapters(): readonly PwdAdapter[] {
  return ADAPTERS;
}
