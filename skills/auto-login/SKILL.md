---
name: auto-login
description: "Log in to a website automatically using credentials saved in the local key store. Use when the user wants unattended/repeat login to a site (no re-scanning QR, no re-typing passwords), e.g. '帮我自动登录这个网站', 'set up auto-login for X', '记住这个网站的登录'. The plaintext password is NEVER seen by you — the user fills it in 秘钥管理 and sudowork fills the form itself."
---

# Website Auto-Login

Set up and run automatic website login. You explore the site and register the
"login recipe" (which fields to fill); the **user** supplies the username/password
in sudowork's 秘钥管理 UI; sudowork then fills the form (incl. image captcha) and
submits — the password never enters your context.

All commands go through the helper (it talks to sudowork over the authenticated
Auth Proxy you already have env for):

```bash
python scripts/auto_login.py <list|register|start> [args]
```

## Hard rule
NEVER ask the user to paste their password to you, and NEVER type a password into
a page yourself. Credentials live only in the key store; you only handle the
non-secret login recipe (selectors + url) and the entry title.

## Workflow

### 1. Explore the login page (use the `browser` skill)
Open the login URL and inspect the form to find CSS selectors for:
- the **username/account** input
- the **password** input
- the **submit/login** button
- (if present) the **captcha text input** and its **captcha `<img>`** element

Verify each selector actually matches (e.g. `browser_get_dom_snapshot` /
`document.querySelector(...)`). Note whether it's `single_step` (all on one page)
or `two_step`.

### 2. Register the login recipe (non-secret)
```bash
python scripts/auto_login.py register \
  --title "<short name, e.g. yidao>" \
  --url "<login page url>" \
  --username-selector "<css>" \
  --password-selector "<css>" \
  --submit-selector "<css>" \
  [--captcha-selector "<css>" --captcha-image-selector "<css>"] \
  --strategy single_step
```

### 3. Ask the user to fill credentials (you stop here)
Tell the user to open **设置 → 远程连接 → 秘钥管理 → 网站自动登录**, expand the entry
with the title you used, fill **用户名 + 密码**, and click 保存凭证. Then ask them to
tell you when done. Do not proceed until they confirm.

### 4. Run the auto-login
```bash
python scripts/auto_login.py start --title "<title>"
```
sudowork reads the credential from the key store, fills the form in the running
browser (solving any image captcha with a vision model), and submits. The result
reports success/navigation only — never the password.

### Check status anytime
```bash
python scripts/auto_login.py list   # sites + whether each already has a saved credential
```
