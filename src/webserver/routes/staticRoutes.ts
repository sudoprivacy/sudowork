/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import express from 'express';
import type { Express, Request, Response } from 'express';
import { TokenMiddleware } from '@/webserver/auth/middleware/TokenMiddleware';
import { AUTH_CONFIG } from '../config/constants';
import { createRateLimiter } from '../middleware/security';

function getViteDevPort(): number {
  const port = Number.parseInt(process.env.VITE_DEV_SERVER_PORT || '5173', 10);
  return Number.isFinite(port) ? port : 5173;
}

/**
 * Try to resolve built renderer assets path, return null if not found
 */
const resolveRendererPath = (): { staticRoot: string; indexHtml: string } | null => {
  const appPath = app.getAppPath();

  const candidates = [
    {
      staticRoot: path.join(appPath, 'out', 'renderer'),
      indexHtml: path.join(appPath, 'out', 'renderer', 'index.html'),
    },
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.indexHtml)) {
      return candidate;
    }
  }

  return null;
};

/**
 * Create a proxy middleware that forwards requests to the Vite dev server
 */
function createViteDevProxy(): (req: Request, res: Response) => void {
  return (req: Request, res: Response) => {
    const viteDevPort = getViteDevPort();

    // Remove ALL restrictive security headers set by Express middleware -
    // Vite dev server content doesn't need them and they block HMR/inline scripts
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('X-Content-Type-Options');
    res.removeHeader('X-XSS-Protection');

    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: viteDevPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${viteDevPort}`,
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const headers = proxyRes.headers;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) {
          try {
            res.setHeader(key, value);
          } catch {
            // Ignore invalid header errors
          }
        }
      }
      res.status(proxyRes.statusCode || 200);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[ViteProxy] Error proxying ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).send(`[WebUI] Vite dev server (localhost:${viteDevPort}) unavailable: ${err.message}`);
      }
    });

    req.pipe(proxyReq);
  };
}

/**
 * Register static asset routes for production mode
 */
function registerProductionStaticRoutes(expressApp: Express, staticRoot: string, indexHtmlPath: string): void {
  const pageRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 300,
    message: 'Too many requests, please try again later',
  });

  const serveApplication = (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const token = TokenMiddleware.extractToken(req);
      if (token && !TokenMiddleware.isTokenValid(token)) {
        res.clearCookie(AUTH_CONFIG.COOKIE.NAME);
      }

      // 如果访问根路径且未认证，重定向到 WebUI 登录页面
      // If accessing root path and not authenticated, redirect to WebUI login page
      if (req.path === '/' && !token) {
        res.redirect('/webui-login');
        return;
      }

      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(htmlContent);
    } catch (error) {
      console.error('Error serving index.html:', error);
      res.status(500).send('Internal Server Error');
    }
  };

  expressApp.get('/', pageRateLimiter, serveApplication);

  // SPA sub-routes (React Router) - exclude /webui-login, /qr-login (these have dedicated pages)
  // SPA 子路由 - 排除 /webui-login, /qr-login（这些有专用页面）
  // /login, /register 等路径需要返回主应用，让 React Router 处理
  expressApp.get(/^\/(?!api|static|assets|webui-login|qr-login)(?!.*\.[a-zA-Z0-9]+$).*/, pageRateLimiter, serveApplication);

  // Static assets
  expressApp.use(express.static(staticRoot));

  const staticDir = path.join(staticRoot, 'static');
  if (fs.existsSync(staticDir) && fs.statSync(staticDir).isDirectory()) {
    expressApp.use('/static', express.static(staticDir));
  }
}

/**
 * Register static assets and page routes
 *
 * In production: serve built files from out/renderer/
 * In development: proxy to Vite dev server (localhost:5173)
 */
export function registerStaticRoutes(expressApp: Express): void {
  const resolved = resolveRendererPath();
  const viteDevPort = getViteDevPort();

  if (resolved) {
    console.log(`[WebUI] Serving renderer from: ${resolved.staticRoot}`);
    registerProductionStaticRoutes(expressApp, resolved.staticRoot, resolved.indexHtml);
    return;
  }

  // No built assets - proxy to Vite dev server in development mode
  console.log(`[WebUI] No renderer build found, proxying to Vite dev server at http://localhost:${viteDevPort}`);
  const proxy = createViteDevProxy();
  expressApp.use(proxy);
}

export default registerStaticRoutes;
