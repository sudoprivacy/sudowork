/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Express, Request, Response } from 'express';
import brand from '@brand';
import { AuthService } from '@/webserver/auth/service/AuthService';
import { AuthMiddleware } from '@/webserver/auth/middleware/AuthMiddleware';
import { UserRepository } from '@/webserver/auth/repository/UserRepository';
import { TokenUtils } from '@/webserver/auth/middleware/TokenMiddleware';
import { verifyQRTokenDirect } from '@/process/bridge/webuiBridge';
import { AUTH_CONFIG, getCookieOptions } from '../config/constants';
import { createAppError } from '../middleware/errorHandler';
import { authRateLimiter, authenticatedActionLimiter, apiRateLimiter } from '../middleware/security';

const escapedBrandName = brand.displayName.replace(/[&<>"']/g, (character) => {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return entities[character];
});

/**
 * QR 登录页面 HTML（静态，不包含用户输入）
 * QR login page HTML (static, no user input embedded)
 * JavaScript 直接从 URL 参数读取 token，避免 XSS
 * JavaScript reads token directly from URL params to prevent XSS
 */
const QR_LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QR Login - ${escapedBrandName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
    .loading { color: #3498db; font-size: 18px; }
    .success { color: #27ae60; }
    .error { color: #e74c3c; }
    .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    h2 { margin-bottom: 16px; }
    p { color: #666; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container" id="content">
    <div class="spinner"></div>
    <p class="loading">Verifying... / 验证中...</p>
  </div>
  <script>
    (async function() {
      var container = document.getElementById('content');
      var params = new URLSearchParams(window.location.search);
      var qrToken = params.get('token');
      if (!qrToken) {
        container.innerHTML = '<h2 class="error">Invalid QR Code</h2><p>The QR code is invalid or missing.</p><p>二维码无效或缺失。</p>';
        return;
      }
      try {
        var response = await fetch('/api/auth/qr-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qrToken: qrToken }),
          credentials: 'include'
        });
        var data = await response.json();
        if (data.success) {
          container.innerHTML = '<h2 class="success">Login Successful!</h2><p>Redirecting... / 登录成功，正在跳转...</p>';
          setTimeout(function() { window.location.href = '/'; }, 1000);
        } else {
          // XSS 安全修复：使用 textContent 而非 innerHTML 插入错误消息
          // XSS Security fix: Use textContent instead of innerHTML for error message
          var h2 = document.createElement('h2');
          h2.className = 'error';
          h2.textContent = 'Login Failed';
          var p1 = document.createElement('p');
          p1.textContent = data.error || 'QR code expired or invalid';
          var p2 = document.createElement('p');
          p2.textContent = '二维码已过期或无效，请重新扫描。';
          container.innerHTML = '';
          container.appendChild(h2);
          container.appendChild(p1);
          container.appendChild(p2);
        }
      } catch (e) {
        container.innerHTML = '<h2 class="error">Error</h2><p>Network error. Please try again.</p><p>网络错误，请重试。</p>';
      }
    })();
  </script>
</body>
</html>`;

/**
 * 注册认证相关路由
 * Register authentication routes
 */
export function registerAuthRoutes(app: Express): void {
  /**
   * 用户登录 - Login endpoint
   * POST /login
   */
  // Login attempts are strictly rate limited to defend against brute force
  // 登录尝试严格限流，防止暴力破解
  app.post('/login', authRateLimiter, AuthMiddleware.validateLoginInput, async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      // Get user from database
      const user = UserRepository.findByUsername(username);
      if (!user) {
        // Use constant time verification to prevent timing attacks
        await AuthService.constantTimeVerify('dummy', 'dummy', true);
        res.status(401).json({
          success: false,
          message: 'Invalid username or password',
        });
        return;
      }

      // Verify password with constant time
      const isValidPassword = await AuthService.constantTimeVerify(password, user.password_hash, true);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          message: 'Invalid username or password',
        });
        return;
      }

      // Generate JWT token
      const token = AuthService.generateToken(user);

      // Update last login
      UserRepository.updateLastLogin(user.id);

      // Set secure cookie（远程模式下启用 secure 标志）
      // Set secure cookie (enable secure flag in remote mode)
      res.cookie(AUTH_CONFIG.COOKIE.NAME, token, {
        ...getCookieOptions(),
        maxAge: AUTH_CONFIG.TOKEN.COOKIE_MAX_AGE,
      });

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          id: user.id,
          username: user.username,
        },
        token,
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  /**
   * 用户登出 - Logout endpoint
   * POST /logout
   */
  // Authenticated endpoints reuse shared limiter keyed by user/IP
  // 已登录接口复用按用户/IP 计数的限流器
  app.post('/logout', apiRateLimiter, AuthMiddleware.authenticateToken, authenticatedActionLimiter, (req: Request, res: Response) => {
    // 将当前 token 加入黑名单 / Blacklist current token
    const token = TokenUtils.extractFromRequest(req);
    if (token) {
      AuthService.blacklistToken(token);
    }

    res.clearCookie(AUTH_CONFIG.COOKIE.NAME);
    res.json({ success: true, message: 'Logged out successfully' });
  });

  /**
   * 获取认证状态 - Get authentication status
   * GET /api/auth/status
   */
  // Rate limit auth status endpoint to prevent enumeration
  // 为认证状态端点添加速率限制以防止枚举攻击
  app.get('/api/auth/status', apiRateLimiter, (_req: Request, res: Response) => {
    try {
      const hasUsers = UserRepository.hasUsers();
      const userCount = UserRepository.countUsers();

      res.json({
        success: true,
        needsSetup: !hasUsers,
        userCount,
        isAuthenticated: false, // Will be determined by frontend based on token
      });
    } catch (error) {
      console.error('Auth status error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * 获取当前用户信息 - Get current user (protected route)
   * GET /api/auth/user
   */
  // Add rate limiting for authenticated user info endpoint
  // 为已认证用户信息端点添加速率限制
  app.get('/api/auth/user', apiRateLimiter, AuthMiddleware.authenticateToken, authenticatedActionLimiter, (req: Request, res: Response) => {
    res.json({
      success: true,
      user: req.user,
    });
  });

  /**
   * 修改密码 - Change password endpoint (protected route)
   * POST /api/auth/change-password
   */
  app.post('/api/auth/change-password', apiRateLimiter, AuthMiddleware.authenticateToken, authenticatedActionLimiter, async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          error: 'Current password and new password are required',
        });
        return;
      }

      // Validate new password strength
      const passwordValidation = AuthService.validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        res.status(400).json({
          success: false,
          error: 'New password does not meet security requirements',
          details: passwordValidation.errors,
        });
        return;
      }

      // Get current user
      const user = UserRepository.findById(req.user!.id);
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      // Verify current password
      const isValidPassword = await AuthService.verifyPassword(currentPassword, user.password_hash);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          error: 'Current password is incorrect',
        });
        return;
      }

      // Hash new password
      const newPasswordHash = await AuthService.hashPassword(newPassword);

      // Update password
      UserRepository.updatePassword(user.id, newPasswordHash);
      AuthService.invalidateAllTokens();

      res.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * Token 刷新 - Token refresh endpoint
   * POST /api/auth/refresh
   */
  app.post('/api/auth/refresh', apiRateLimiter, authenticatedActionLimiter, (req: Request, res: Response) => {
    try {
      const { token } = req.body;

      if (!token) {
        res.status(400).json({
          success: false,
          error: 'Token is required',
        });
        return;
      }

      const newToken = AuthService.refreshToken(token);
      if (!newToken) {
        res.status(401).json({
          success: false,
          error: 'Invalid or expired token',
        });
        return;
      }

      res.json({
        success: true,
        token: newToken,
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * 生成 WebSocket Token - Generate WebSocket token
   * GET /api/ws-token
   *
   * 注意：现在 WebSocket 直接复用主 token，此接口返回主 token 以保持向后兼容
   * Note: WebSocket now reuses the main token, this endpoint returns the main token for backward compatibility
   */
  // Rate limit WebSocket token endpoint
  // 为 WebSocket token 端点添加速率限制
  app.get('/api/ws-token', apiRateLimiter, authenticatedActionLimiter, (req: Request, res: Response, next) => {
    try {
      const sessionToken = TokenUtils.extractFromRequest(req);

      if (!sessionToken) {
        return next(createAppError('Unauthorized: Invalid or missing session', 401, 'unauthorized'));
      }

      const decoded = AuthService.verifyToken(sessionToken);
      if (!decoded) {
        return next(createAppError('Unauthorized: Invalid session token', 401, 'unauthorized'));
      }

      const user = UserRepository.findById(decoded.userId);
      if (!user) {
        return next(createAppError('Unauthorized: User not found', 401, 'unauthorized'));
      }

      // 直接返回主 token，不再生成单独的 WebSocket token
      res.json({
        success: true,
        wsToken: sessionToken, // 复用主 token
        expiresIn: AUTH_CONFIG.TOKEN.COOKIE_MAX_AGE, // 使用主 token 的过期时间
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * 二维码登录验证 - QR code login verification
   * POST /api/auth/qr-login
   */
  app.post('/api/auth/qr-login', authRateLimiter, async (req: Request, res: Response) => {
    try {
      const { qrToken } = req.body;

      if (!qrToken) {
        res.status(400).json({
          success: false,
          error: 'QR token is required',
        });
        return;
      }

      // 获取客户端 IP（用于本地网络限制验证）
      // Get client IP (for local network restriction verification)
      const clientIP = req.ip || req.socket.remoteAddress || '';

      // 直接验证 QR token（无需 IPC）/ Verify QR token directly (no IPC)
      const result = await verifyQRTokenDirect(qrToken, clientIP);

      if (!result.success || !result.data) {
        res.status(401).json({
          success: false,
          error: result.msg || 'Invalid or expired QR token',
        });
        return;
      }

      // 设置 session cookie（远程模式下启用 secure 标志）
      // Set session cookie (enable secure flag in remote mode)
      res.cookie(AUTH_CONFIG.COOKIE.NAME, result.data.sessionToken, {
        ...getCookieOptions(),
        maxAge: AUTH_CONFIG.TOKEN.COOKIE_MAX_AGE,
      });

      res.json({
        success: true,
        user: { username: result.data.username },
        token: result.data.sessionToken,
      });
    } catch (error) {
      console.error('QR login error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * 二维码登录页面 - QR code login page
   * GET /qr-login
   * 安全处理：返回静态 HTML，JavaScript 从 URL 读取 token，避免 XSS
   * Security: Return static HTML, JavaScript reads token from URL to prevent XSS
   */
  app.get('/qr-login', (_req: Request, res: Response) => {
    res.send(QR_LOGIN_PAGE_HTML);
  });

  /**
   * WebUI 专用登录页面 - WebUI dedicated login page
   * GET /webui-login
   * 返回 WebUI 专用的用户名/密码登录页面（不影响 App 的手机号登录）
   * Returns WebUI dedicated username/password login page (does not affect App's phone login)
   */
  app.get('/webui-login', (req: Request, res: Response) => {
    try {
      const token = TokenUtils.extractFromRequest(req);
      // 如果 token 存在但无效，清除 cookie
      // If token exists but is invalid, clear cookie
      if (token) {
        const decoded = AuthService.verifyToken(token);
        if (!decoded) {
          res.clearCookie(AUTH_CONFIG.COOKIE.NAME);
        }
      }
      res.send(`<!DOCTYPE html>
<html data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebUI Login - ${escapedBrandName}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB3aWR0aD0iNDBweCIgaGVpZ2h0PSI0MHB4IiB2aWV3Qm94PSIwIDAgMjEgMjQiIHZlcnNpb249IjEuMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+CiAgICA8IS0tIEdlbmVyYXRvcjogU2tldGNoIDYxLjIgKDg5NjUzKSAtIGh0dHBzOi8vc2tldGNoLmNvbSAtLT4KICAgIDx0aXRsZT7mlbDniY1zdWRvPC90aXRsZT4KICAgIDxkZXNjPkNyZWF0ZWQgd2l0aCBTa2V0Y2guPC9kZXNjPgogICAgPGcgaWQ9IumjjuagvCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiIGZpbGw9Im5vbmUiIGZpbGwtcnVsZT0iZXZlbm9kZCI+CiAgICAgICAgPGcgaWQ9IumhueebruWIl+ihqC3ljaHniYflvI/lm74iIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0yOC4wMDAwMDAsIC0xNi4wMDAwMDApIiBmaWxsPSIjRjU5RTBCIiBmaWxsLXJ1bGU9Im5vbnplcm8iPgogICAgICAgICAgICA8ZyBpZD0i5pWw54mNc3VkbyIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjguMDAwMDAwLCAxNi4wMDAwMDApIj4KICAgICAgICAgICAgICAgIDxnIGlkPSJMYXllcl8zX2NvcHkiPgogICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yMC44Njc4NDc0LDYuMDcxNjg4MzEgQzIwLjgyNzI5Nyw1Ljk3ODE4MTgyIDIwLjc1ODY3MzMsNS44OTcxNDI4NiAyMC42NzEzMzQsNS44NDcyNzI3MyBMMTUuNjg2NzU3LDIuOTcwMzg5NjEgTDE1LjY4MzYzNzcsMi45NjcyNzI3MyBMMTUuNjgwNTE4NSwyLjk2NzI3MjczIEwxMC42OTU5NDE1LDAuMDkwMzg5NjEwNCBMMTAuNjkyODIyMiwwLjA4NzI3MjcyNzMgQzEwLjU0NjIxNywwLjAwMzExNjg4MzEyIDEwLjM2ODQxOTIsLTQuNTc5NjY5OThlLTE2IDEwLjIyMTgxNCwwLjA4NDE1NTg0NDIgTDAuMjQwMTgyOTk3LDUuODQxMDM4OTYgQzAuMDk2Njk3MDUwNiw1LjkyNTE5NDgxIDAuMDA2MjM4NTE5MzksNi4wODEwMzg5NiAwLjAwNjIzODUxOTM5LDYuMjQ5MzUwNjUgTDAuMDA2MjM4NTE5MzksMTIuMDAzMTE2OSBDMC4wMDYyMzg1MTkzOSwxMi4wMDMxMTY5IDAuMDA2MjM4NTE5MzksMTIuMDA2MjMzOCAwLjAwNjIzODUxOTM5LDEyLjAwOTM1MDYgQzAuMDA2MjM4NTE5MzksMTIuMDEyNDY3NSAwLjAwNjIzODUxOTM5LDEyLjAxMjQ2NzUgMC4wMDYyMzg1MTkzOSwxMi4wMTI0Njc1IEwwLjAwNjIzODUxOTM5LDE3Ljc2NjIzMzggQzAuMDA2MjM4NTE5MzksMTcuNzY2MjMzOCAwLjAwNjIzODUxOTM5LDE3Ljc2OTM1MDYgMC4wMDYyMzg1MTkzOSwxNy43NjkzNTA2IEMwLjAwNjIzODUxOTM5LDE3LjkzNzY2MjMgMC4wOTY2OTcwNTA2LDE4LjA5MDM4OTYgMC4yNDAxODI5OTcsMTguMTc0NTQ1NSBMMTAuMjIxODE0LDIzLjkzNDU0NTUgQzEwLjM2NTMsMjQuMDE4NzAxMyAxMC41NDYyMTcsMjQuMDE4NzAxMyAxMC42ODk3MDMsMjMuOTM0NTQ1NSBDMTAuNjk5MDYwOCwyMy45MjgzMTE3IDEwLjcxMTUzNzgsMjMuOTIyMDc3OSAxMC43MjA4OTU2LDIzLjkxMjcyNzMgTDE1LjY3NDI4LDIxLjA1NDU0NTUgTDE1LjY4MDUxODUsMjEuMDUxNDI4NiBMMTUuNjgzNjM3NywyMS4wNDgzMTE3IEwyMC42NjgyMTQ3LDE4LjE3NDU0NTUgTDIwLjY3MTMzNCwxOC4xNzE0Mjg2IEMyMC44MTQ4MTk5LDE4LjA4NzI3MjcgMjAuOTA1Mjc4NSwxNy45MzQ1NDU1IDIwLjkwNTI3ODUsMTcuNzY2MjMzOCBMMjAuOTA1Mjc4NSw2LjI1MjQ2NzUzIEMyMC45MDUyNzg1LDYuMTkwMTI5ODcgMjAuODkyODAxNCw2LjEzMDkwOTA5IDIwLjg2Nzg0NzQsNi4wNzE2ODgzMSBaIE0xNS45MTQ0NjMsMTQuNjIxMjk4NyBMMTUuOTE0NDYzLDkuNDAzNjM2MzYgTDE5Ljk2OTUwMDYsNy4wNjI4NTcxNCBMMTkuOTY5NTAwNiwxNi45NTg5NjEgTDE1LjkxNDQ2MywxNC42MjEyOTg3IFogTTE0Ljk3ODY4NTEsNC4xODI4NTcxNCBMMTQuOTc4Njg1MSw4Ljg2MTI5ODcgTDEwLjQ1NTc1ODUsMTEuNDcwMTI5OSBMNi40MDA3MjA5LDkuMTMyNDY3NTMgTDE0Ljk3ODY4NTEsNC4xODI4NTcxNCBaIE00LjUyNjA0NTgyLDkuMTMyNDY3NTMgTDAuOTM4ODk3MTY4LDExLjIwMjA3NzkgTDAuOTM4ODk3MTY4LDcuMDYyODU3MTQgTDQuNTI2MDQ1ODIsOS4xMzI0Njc1MyBaIE01LjQ2MTgyMzczLDkuNjcxNjg4MzEgTDkuOTg0NzUwMjksMTIuMjgwNTE5NSBMOS45ODQ3NTAyOSwxNi45NTg5NjEgTDEuNDA2Nzg2MTIsMTIuMDA5MzUwNiBMNS40NjE4MjM3Myw5LjY3MTY4ODMxIFogTTkuOTg3ODY5NTUsMTguMDQwNTE5NSBMOS45ODc4Njk1NSwyMi43MTg5NjEgTDEuNDA5OTA1MzgsMTcuNzY5MzUwNiBMNS40NjQ5NDI5OSwxNS40MzE2ODgzIEw5Ljk4Nzg2OTU1LDE4LjA0MDUxOTUgWiBNMTAuOTIzNjQ3NSwxMi4yODA1MTk1IEwxNC45NzU1NjU4LDkuOTQyODU3MTQgTDE0Ljk3NTU2NTgsMTkuODM4OTYxIEwxMC45MjM2NDc1LDE3LjUwMTI5ODcgTDEwLjkyMzY0NzUsMTIuMjgwNTE5NSBaIE0xNS45MTQ0NjMsOC4zMTg5NjEwNCBMMTUuOTE0NDYzLDQuMTgyODU3MTQgTDE5LjQ5ODQ5MjQsNi4yNTI0Njc1MyBMMTUuOTE0NDYzLDguMzE4OTYxMDQgWiBNMTAuOTIzNjQ3NSw1LjQ0MjA3NzkyIEwxMC45MjM2NDc1LDEuMzAyODU3MTQgTDE0LjUxMDc5NjEsMy4zNzI0Njc1MyBMMTAuOTIzNjQ3NSw1LjQ0MjA3NzkyIFogTTkuOTg3ODY5NTUsNS45ODEyOTg3IEw1LjQ2NDk0Mjk5LDguNTkwMTI5ODcgTDEuNDA5OTA1MzgsNi4yNDkzNTA2NSBMOS45ODc4Njk1NSwxLjMwMjg1NzE0IEw5Ljk4Nzg2OTU1LDUuOTgxMjk4NyBaIE0wLjk0MjAxNjQyOCwxMi44MTk3NDAzIEw0LjUyOTE2NTA4LDE0Ljg4OTM1MDYgTDAuOTQyMDE2NDI4LDE2Ljk1ODk2MSBMMC45NDIwMTY0MjgsMTIuODE5NzQwMyBaIE0xMC45MjM2NDc1LDE4LjU3OTc0MDMgTDE0LjUwNzY3NjgsMjAuNjQ2MjMzOCBMMTAuOTIzNjQ3NSwyMi43MTI3MjczIEwxMC45MjM2NDc1LDE4LjU3OTc0MDMgWiBNMTUuOTExMzQzNywxNS42OTk3NDAzIEwxOS40OTg0OTI0LDE3Ljc2OTM1MDYgTDE1LjkxMTM0MzcsMTkuODM4OTYxIEwxNS45MTEzNDM3LDE1LjY5OTc0MDMgWiIgaWQ9IuW9oueKtiI+PC9wYXRoPgogICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICA8L2c+CiAgICAgICAgPC9nPgogICAgPC9nPgo8L3N2Zz4=">
  <script>
    // 同步从 localStorage 恢复主题，防止闪烁
    (function () {
      try {
        var theme = localStorage.getItem('__sudowork_theme') || localStorage.getItem('__aionui_theme');
        if (theme) {
          document.documentElement.setAttribute('data-theme', theme);
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      } catch (e) {}
    })();
  </script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      transition: background 0.3s ease;
    }
    [data-theme='dark'] body {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    }
    .login-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      width: 100%;
      max-width: 400px;
      transition: background 0.3s ease, box-shadow 0.3s ease;
    }
    [data-theme='dark'] .login-card {
      background: rgba(30, 30, 40, 0.95);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .logo { width: 72px; height: 72px; margin: 0 auto 20px; display: block; }
    .title { font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; text-align: center; margin-bottom: 8px; }
    [data-theme='dark'] .title {
      background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle { font-size: 13px; color: #666; text-align: center; margin-bottom: 24px; }
    [data-theme='dark'] .subtitle {
      color: rgba(255, 255, 255, 0.7);
    }
    .hint { font-size: 12px; color: #999; text-align: center; margin-bottom: 24px; }
    [data-theme='dark'] .hint {
      color: rgba(255, 255, 255, 0.5);
    }
    .form-group { margin-bottom: 20px; }
    .label { display: block; font-size: 12px; font-weight: 600; color: #666; margin-bottom: 8px; }
    [data-theme='dark'] .label {
      color: rgba(255, 255, 255, 0.7);
    }
    .input {
      width: 100%;
      height: 48px;
      padding: 12px 16px;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      font-size: 15px;
      transition: border-color 0.2s, background 0.2s;
      background: #fafafa;
      color: #333;
    }
    [data-theme='dark'] .input {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.9);
    }
    .input:hover { border-color: #d0d0d0; }
    [data-theme='dark'] .input:hover {
      border-color: rgba(255, 255, 255, 0.2);
    }
    .input:focus { outline: none; border-color: #667eea; background: #fff; }
    [data-theme='dark'] .input:focus {
      border-color: #8b5cf6;
      background: rgba(255, 255, 255, 0.08);
    }
    .input::placeholder { color: #aaa; }
    [data-theme='dark'] .input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }
    .submit-btn {
      width: 100%;
      height: 52px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 12px;
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s;
      margin-top: 8px;
    }
    [data-theme='dark'] .submit-btn {
      background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
    }
    .submit-btn:hover { opacity: 0.9; }
    .submit-btn:active { opacity: 0.8; }
    .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .footer { font-size: 12px; color: #999; text-align: center; margin-top: 24px; line-height: 1.6; }
    [data-theme='dark'] .footer {
      color: rgba(255, 255, 255, 0.5);
    }
    .message { padding: 12px 16px; border-radius: 10px; font-size: 14px; margin-top: 16px; display: none; }
    .message.error { background: rgba(244, 67, 54, 0.1); color: #f44336; border: 1px solid rgba(244, 67, 54, 0.2); }
    .message.success { background: rgba(76, 175, 80, 0.1); color: #4caf50; border: 1px solid rgba(76, 175, 80, 0.2); }
    @media (max-width: 480px) { .login-card { padding: 32px 24px; } }
  </style>
</head>
<body>
  <div class="login-card">
    <img class="logo" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB3aWR0aD0iNDBweCIgaGVpZ2h0PSI0MHB4IiB2aWV3Qm94PSIwIDAgMjEgMjQiIHZlcnNpb249IjEuMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+CiAgICA8IS0tIEdlbmVyYXRvcjogU2tldGNoIDYxLjIgKDg5NjUzKSAtIGh0dHBzOi8vc2tldGNoLmNvbSAtLT4KICAgIDx0aXRsZT7mlbDniY1zdWRvPC90aXRsZT4KICAgIDxkZXNjPkNyZWF0ZWQgd2l0aCBTa2V0Y2guPC9kZXNjPgogICAgPGcgaWQ9IumjjuagvCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiIGZpbGw9Im5vbmUiIGZpbGwtcnVsZT0iZXZlbm9kZCI+CiAgICAgICAgPGcgaWQ9IumhueebruWIl+ihqC3ljaHniYflvI/lm74iIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0yOC4wMDAwMDAsIC0xNi4wMDAwMDApIiBmaWxsPSIjRjU5RTBCIiBmaWxsLXJ1bGU9Im5vbnplcm8iPgogICAgICAgICAgICA8ZyBpZD0i5pWw54mNc3VkbyIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjguMDAwMDAwLCAxNi4wMDAwMDApIj4KICAgICAgICAgICAgICAgIDxnIGlkPSJMYXllcl8zX2NvcHkiPgogICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yMC44Njc4NDc0LDYuMDcxNjg4MzEgQzIwLjgyNzI5Nyw1Ljk3ODE4MTgyIDIwLjc1ODY3MzMsNS44OTcxNDI4NiAyMC42NzEzMzQsNS44NDcyNzI3MyBMMTUuNjg2NzU3LDIuOTcwMzg5NjEgTDE1LjY4MzYzNzcsMi45NjcyNzI3MyBMMTUuNjgwNTE4NSwyLjk2NzI3MjczIEwxMC42OTU5NDE1LDAuMDkwMzg5NjEwNCBMMTAuNjkyODIyMiwwLjA4NzI3MjcyNzMgQzEwLjU0NjIxNywwLjAwMzExNjg4MzEyIDEwLjM2ODQxOTIsLTQuNTc5NjY5OThlLTE2IDEwLjIyMTgxNCwwLjA4NDE1NTg0NDIgTDAuMjQwMTgyOTk3LDUuODQxMDM4OTYgQzAuMDk2Njk3MDUwNiw1LjkyNTE5NDgxIDAuMDA2MjM4NTE5MzksNi4wODEwMzg5NiAwLjAwNjIzODUxOTM5LDYuMjQ5MzUwNjUgTDAuMDA2MjM4NTE5MzksMTIuMDAzMTE2OSBDMC4wMDYyMzg1MTkzOSwxMi4wMDMxMTY5IDAuMDA2MjM4NTE5MzksMTIuMDA2MjMzOCAwLjAwNjIzODUxOTM5LDEyLjAwOTM1MDYgQzAuMDA2MjM4NTE5MzksMTIuMDEyNDY3NSAwLjAwNjIzODUxOTM5LDEyLjAxMjQ2NzUgMC4wMDYyMzg1MTkzOSwxMi4wMTI0Njc1IEwwLjAwNjIzODUxOTM5LDE3Ljc2NjIzMzggQzAuMDA2MjM4NTE5MzksMTcuNzY2MjMzOCAwLjAwNjIzODUxOTM5LDE3Ljc2OTM1MDYgMC4wMDYyMzg1MTkzOSwxNy43NjkzNTA2IEMwLjAwNjIzODUxOTM5LDE3LjkzNzY2MjMgMC4wOTY2OTcwNTA2LDE4LjA5MDM4OTYgMC4yNDAxODI5OTcsMTguMTc0NTQ1NSBMMTAuMjIxODE0LDIzLjkzNDU0NTUgQzEwLjM2NTMsMjQuMDE4NzAxMyAxMC41NDYyMTcsMjQuMDE4NzAxMyAxMC42ODk3MDMsMjMuOTM0NTQ1NSBDMTAuNjk5MDYwOCwyMy45MjgzMTE3IDEwLjcxMTUzNzgsMjMuOTIyMDc3OSAxMC43MjA4OTU2LDIzLjkxMjcyNzMgTDE1LjY3NDI4LDIxLjA1NDU0NTUgTDE1LjY4MDUxODUsMjEuMDUxNDI4NiBMMTUuNjgzNjM3NywyMS4wNDgzMTE3IEwyMC42NjgyMTQ3LDE4LjE3NDU0NTUgTDIwLjY3MTMzNCwxOC4xNzE0Mjg2IEMyMC44MTQ4MTk5LDE4LjA4NzI3MjcgMjAuOTA1Mjc4NSwxNy45MzQ1NDU1IDIwLjkwNTI3ODUsMTcuNzY2MjMzOCBMMjAuOTA1Mjc4NSw2LjI1MjQ2NzUzIEMyMC45MDUyNzg1LDYuMTkwMTI5ODcgMjAuODkyODAxNCw2LjEzMDkwOTA5IDIwLjg2Nzg0NzQsNi4wNzE2ODgzMSBaIE0xNS45MTQ0NjMsMTQuNjIxMjk4NyBMMTUuOTE0NDYzLDkuNDAzNjM2MzYgTDE5Ljk2OTUwMDYsNy4wNjI4NTcxNCBMMTkuOTY5NTAwNiwxNi45NTg5NjEgTDE1LjkxNDQ2MywxNC42MjEyOTg3IFogTTE0Ljk3ODY4NTEsNC4xODI4NTcxNCBMMTQuOTc4Njg1MSw4Ljg2MTI5ODcgTDEwLjQ1NTc1ODUsMTEuNDcwMTI5OSBMNi40MDA3MjA5LDkuMTMyNDY3NTMgTDE0Ljk3ODY4NTEsNC4xODI4NTcxNCBaIE00LjUyNjA0NTgyLDkuMTMyNDY3NTMgTDAuOTM4ODk3MTY4LDExLjIwMjA3NzkgTDAuOTM4ODk3MTY4LDcuMDYyODU3MTQgTDQuNTI2MDQ1ODIsOS4xMzI0Njc1MyBaIE01LjQ2MTgyMzczLDkuNjcxNjg4MzEgTDkuOTg0NzUwMjksMTIuMjgwNTE5NSBMOS45ODQ3NTAyOSwxNi45NTg5NjEgTDEuNDA2Nzg2MTIsMTIuMDA5MzUwNiBMNS40NjE4MjM3Myw5LjY3MTY4ODMxIFogTTkuOTg3ODY5NTUsMTguMDQwNTE5NSBMOS45ODc4Njk1NSwyMi43MTg5NjEgTDEuNDA5OTA1MzgsMTcuNzY5MzUwNiBMNS40NjQ5NDI5OSwxNS40MzE2ODgzIEw5Ljk4Nzg2OTU1LDE4LjA0MDUxOTUgWiBNMTAuOTIzNjQ3NSwxMi4yODA1MTk1IEwxNC45NzU1NjU4LDkuOTQyODU3MTQgTDE0Ljk3NTU2NTgsMTkuODM4OTYxIEwxMC45MjM2NDc1LDE3LjUwMTI5ODcgTDEwLjkyMzY0NzUsMTIuMjgwNTE5NSBaIE0xNS45MTQ0NjMsOC4zMTg5NjEwNCBMMTUuOTE0NDYzLDQuMTgyODU3MTQgTDE5LjQ5ODQ5MjQsNi4yNTI0Njc1MyBMMTUuOTE0NDYzLDguMzE4OTYxMDQgWiBNMTAuOTIzNjQ3NSw1LjQ0MjA3NzkyIEwxMC45MjM2NDc1LDEuMzAyODU3MTQgTDE0LjUxMDc5NjEsMy4zNzI0Njc1MyBMMTAuOTIzNjQ3NSw1LjQ0MjA3NzkyIFogTTkuOTg3ODY5NTUsNS45ODEyOTg3IEw1LjQ2NDk0Mjk5LDguNTkwMTI5ODcgTDEuNDA5OTA1MzgsNi4yNDkzNTA2NSBMOS45ODc4Njk1NSwxLjMwMjg1NzE0IEw5Ljk4Nzg2OTU1LDUuOTgxMjk4NyBaIE0wLjk0MjAxNjQyOCwxMi44MTk3NDAzIEw0LjUyOTE2NTA4LDE0Ljg4OTM1MDYgTDAuOTQyMDE2NDI4LDE2Ljk1ODk2MSBMMC45NDIwMTY0MjgsMTIuODE5NzQwMyBaIE0xMC45MjM2NDc1LDE4LjU3OTc0MDMgTDE0LjUwNzY3NjgsMjAuNjQ2MjMzOCBMMTAuOTIzNjQ3NSwyMi43MTI3MjczIEwxMC45MjM2NDc1LDE4LjU3OTc0MDMgWiBNMTUuOTExMzQzNywxNS42OTk3NDAzIEwxOS40OTg0OTI0LDE3Ljc2OTM1MDYgTDE1LjkxMTM0MzcsMTkuODM4OTYxIEwxNS45MTEzNDM3LDE1LjY5OTc0MDMgWiIgaWQ9IuW9oueKtiI+PC9wYXRoPgogICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICA8L2c+CiAgICAgICAgPC9nPgogICAgPC9nPgo8L3N2Zz4=" alt="${escapedBrandName}">
    <h1 class="title">${escapedBrandName}</h1>
    <p class="subtitle">WebUI Remote Access</p>
    <p class="hint">使用远程连接设置中的管理员凭证登录</p>

    <form id="loginForm">
      <div class="form-group">
        <label class="label" for="username">用户名</label>
        <input class="input" id="username" type="text" placeholder="请输入用户名" autocomplete="username" required />
      </div>

      <div class="form-group">
        <label class="label" for="password">密码</label>
        <input class="input" id="password" type="password" placeholder="请输入密码" autocomplete="current-password" required />
      </div>

      <button class="submit-btn" type="submit" id="submitBtn">登录</button>
    </form>

    <div id="message" class="message"></div>

    <div class="footer">
      <p>提示：首次启动时，密码显示在远程连接设置中</p>
      <p>如需修改密码，请在登录后前往设置页面</p>
    </div>
  </div>

  <script>
    (function() {
      var form = document.getElementById('loginForm');
      var submitBtn = document.getElementById('submitBtn');
      var message = document.getElementById('message');
      var usernameInput = document.getElementById('username');
      var passwordInput = document.getElementById('password');

      function showMessage(text, type) {
        message.textContent = text;
        message.className = 'message ' + type;
        message.style.display = 'block';
      }

      form.addEventListener('submit', async function(e) {
        e.preventDefault();

        var username = usernameInput.value.trim();
        var password = passwordInput.value;

        if (!username || !password) {
          showMessage('请填写用户名和密码', 'error');
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '登录中...';
        message.style.display = 'none';

        try {
          var response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username: username, password: password })
          });

          var data = await response.json();

          if (data.success) {
            showMessage('登录成功！正在跳转...', 'success');
            setTimeout(function() {
              window.location.href = '/';
            }, 1000);
          } else {
            // 使用 i18n 翻译的错误消息
            var errorMsg = data.message === 'Invalid username or password'
              ? '用户名或密码错误'
              : (data.message || '登录失败，请稍后再试');
            showMessage(errorMsg, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '登录';
          }
        } catch (error) {
          console.error('Login error:', error);
          showMessage('连接失败，请稍后重试', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = '登录';
        }
      });
    })();
  </script>
</body>
</html>`);
    } catch (error) {
      console.error('Error serving webui-login page:', error);
      res.status(500).send('Internal Server Error');
    }
  });
}

export default registerAuthRoutes;
