/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { TokenMiddleware } from '@/webserver/auth/middleware/TokenMiddleware';
import { ExtensionRegistry } from '@/extensions';
import directoryApi from '../directoryApi';
import { apiRateLimiter } from '../middleware/security';

const SKILL_HUB_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills';
const SKILL_HUB_AUTHORIZATION = 'sud0@sudo';

function normalizeMountPath(input: string): string {
  if (!input || input.trim() === '') return '/';
  return input.startsWith('/') ? input : `/${input}`;
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function resolveRouteHandler(moduleExports: unknown): RequestHandler | null {
  if (typeof moduleExports === 'function') {
    return moduleExports as RequestHandler;
  }

  if (!moduleExports || typeof moduleExports !== 'object') {
    return null;
  }

  const maybeDefault = (moduleExports as { default?: unknown }).default;
  if (typeof maybeDefault === 'function') {
    return maybeDefault as RequestHandler;
  }

  return null;
}

function wrapRouteHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function runMiddlewareStack(req: Request, res: Response, next: NextFunction, stack: RequestHandler[]): void {
  let index = 0;
  const dispatch = (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    const current = stack[index++];
    if (!current) {
      return;
    }
    try {
      Promise.resolve(current(req, res, (middlewareErr?: unknown) => dispatch(middlewareErr))).catch(dispatch);
    } catch (error) {
      dispatch(error);
    }
  };
  dispatch();
}

type MatchedApiRoute = {
  extensionName: string;
  routePath: string;
  routeEntry: string;
  auth: boolean;
};

type MatchedStaticAsset = {
  extensionName: string;
  filePath: string;
};

function resolveMatchedApiRoute(requestPath: string): MatchedApiRoute | null {
  const registry = ExtensionRegistry.getInstance();
  const contributions = registry.getWebuiContributions();
  for (const contribution of contributions) {
    const extensionRoot = path.resolve(contribution.directory);
    for (const route of contribution.config.apiRoutes || []) {
      const routePath = normalizeMountPath(route.path);
      if (routePath !== requestPath) continue;
      const routeEntry = path.resolve(extensionRoot, route.entryPoint);
      if (!isPathInsideRoot(routeEntry, extensionRoot)) continue;
      return {
        extensionName: contribution.extensionName,
        routePath,
        routeEntry,
        auth: route.auth !== false,
      };
    }
  }
  return null;
}

function resolveMatchedStaticAsset(requestPath: string): MatchedStaticAsset | null {
  const registry = ExtensionRegistry.getInstance();
  const contributions = registry.getWebuiContributions();
  for (const contribution of contributions) {
    const extensionRoot = path.resolve(contribution.directory);
    for (const asset of contribution.config.staticAssets || []) {
      const urlPrefix = normalizeMountPath(asset.urlPrefix);
      if (!(requestPath === urlPrefix || requestPath.startsWith(`${urlPrefix}/`))) continue;
      const staticRoot = path.resolve(extensionRoot, asset.directory);
      if (!isPathInsideRoot(staticRoot, extensionRoot)) continue;

      const relativePart = requestPath.slice(urlPrefix.length);
      if (!relativePart || relativePart === '/') continue;
      const filePath = path.resolve(staticRoot, `.${relativePart}`);
      if (!isPathInsideRoot(filePath, staticRoot)) continue;
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      return { extensionName: contribution.extensionName, filePath };
    }
  }
  return null;
}

function registerExtensionWebuiRoutes(app: Express, validateApiAccess: RequestHandler): void {
  // eslint-disable-next-line no-eval
  const nativeRequire = eval('require') as NodeRequire;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestPath = normalizeMountPath(req.path || '/');

    const staticMatch = resolveMatchedStaticAsset(requestPath);
    if (staticMatch) {
      const stack: RequestHandler[] = [
        apiRateLimiter,
        (_req, response, middlewareNext) => {
          response.setHeader('Cache-Control', 'public, max-age=3600');
          middlewareNext();
        },
        (_req, response, middlewareNext) => {
          response.sendFile(staticMatch.filePath, (error) => {
            if (error) middlewareNext(error);
          });
        },
      ];
      runMiddlewareStack(req, res, next, stack);
      return;
    }

    const routeMatch = resolveMatchedApiRoute(requestPath);
    if (!routeMatch) {
      // Extension namespaces should not silently fall through to the SPA handler.
      // This prevents disabled/unknown extension routes from returning 200 HTML.
      if (/^\/ext-[a-z0-9-]+(?:\/|$)/i.test(requestPath)) {
        res.status(404).json({ message: 'Extension route not found' });
        return;
      }
      next();
      return;
    }

    let routeModule: unknown;
    try {
      routeModule = nativeRequire(routeMatch.routeEntry);
    } catch (error) {
      console.error(`[WebUI] Failed to load API route module: ${routeMatch.routeEntry} (${routeMatch.extensionName})`, error);
      res.status(500).json({ message: 'Failed to load extension API route' });
      return;
    }

    const handler = resolveRouteHandler(routeModule);
    if (!handler) {
      console.warn(`[WebUI] API route has no function export: ${routeMatch.routeEntry} (${routeMatch.extensionName})`);
      res.status(500).json({ message: 'Invalid extension API route handler' });
      return;
    }

    const stack: RequestHandler[] = [apiRateLimiter];
    if (routeMatch.auth) {
      stack.push(validateApiAccess);
    }
    stack.push(wrapRouteHandler(handler));
    runMiddlewareStack(req, res, next, stack);
  });
}

/**
 * 注册 API 路由
 * Register API routes
 */
export function registerApiRoutes(app: Express): void {
  const validateApiAccess = TokenMiddleware.validateToken({ responseType: 'json' });

  /**
   * 目录 API - Directory API
   * /api/directory/*
   */
  app.use('/api/directory', apiRateLimiter, validateApiAccess, directoryApi);

  registerExtensionWebuiRoutes(app, validateApiAccess);

  /**
   * 扩展资产 API（WebUI）- Extension asset API (WebUI)
   * GET /api/ext-asset?path={absolutePath}
   */
  app.get('/api/ext-asset', apiRateLimiter, validateApiAccess, (req: Request, res: Response) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!rawPath) {
      return res.status(400).json({ message: 'Missing path query parameter' });
    }

    const normalizedPath = path.resolve(rawPath);
    const registry = ExtensionRegistry.getInstance();
    const allowedRoots = registry.getLoadedExtensions().map((ext) => path.resolve(ext.directory));
    const isAllowed = allowedRoots.some((root) => normalizedPath === root || normalizedPath.startsWith(`${root}${path.sep}`));

    if (!isAllowed) {
      return res.status(403).json({ message: 'Access denied: path is outside extension directories' });
    }

    if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    return res.sendFile(normalizedPath);
  });

  /**
   * 通用 API 端点 - Generic API endpoint
   * GET /api
   */
  app.use('/api', apiRateLimiter, validateApiAccess, (_req: Request, res: Response) => {
    res.json({ message: 'API endpoint - bridge integration working' });
  });

  /**
   * Skill Hub API - 技能中心 API
   * GET /api/skill-hub/skills - 获取技能列表
   * GET /api/skill-hub/categories - 获取分类列表
   * GET /api/skill-hub/skills/:skillId - 获取技能详情
   */
  app.get('/api/skill-hub/skills', apiRateLimiter, validateApiAccess, async (req: Request, res: Response) => {
    try {
      const page = typeof req.query.page === 'string' ? req.query.page : '1';
      const size = typeof req.query.size === 'string' ? req.query.size : '200';
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      const category = typeof req.query.category === 'string' ? req.query.category : '';

      const params = new URLSearchParams({ page, size, query, category });
      const response = await fetch(`${SKILL_HUB_BASE_URL}?${params}`, {
        headers: { Authorization: SKILL_HUB_AUTHORIZATION },
      });
      const data = await response.json();
      res.json({ success: true, data });
    } catch (error) {
      console.error('[SkillHub API] Failed to fetch skills:', error);
      res.status(500).json({ success: false, msg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/skill-hub/skills/cursor', apiRateLimiter, validateApiAccess, async (req: Request, res: Response) => {
    try {
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
      const limit = typeof req.query.limit === 'string' ? req.query.limit : '20';
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      const category = typeof req.query.category === 'string' ? req.query.category : '';

      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', limit);
      if (query) params.set('query', query);
      if (category) params.set('category', category);

      const response = await fetch(`https://sudoclawhub.sudoprivacy.com/api/skills/cursor?${params}`, {
        headers: { Authorization: SKILL_HUB_AUTHORIZATION },
      });
      const result = await response.json();
      // Return only the data part to match IBridgeResponse<ISkillHubListResponse>
      res.json({ success: true, data: result.data });
    } catch (error) {
      console.error('[SkillHub API] Failed to fetch skills with cursor:', error);
      res.status(500).json({ success: false, msg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/skill-hub/categories', apiRateLimiter, validateApiAccess, async (_req: Request, res: Response) => {
    try {
      const response = await fetch(`${SKILL_HUB_BASE_URL}/categories`, {
        headers: { Authorization: SKILL_HUB_AUTHORIZATION },
      });
      const data = await response.json();
      res.json({ success: true, data: data.data || [] });
    } catch (error) {
      console.error('[SkillHub API] Failed to fetch categories:', error);
      res.status(500).json({ success: false, msg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/skill-hub/skills/:skillId', apiRateLimiter, validateApiAccess, async (req: Request, res: Response) => {
    try {
      const { skillId } = req.params;
      const response = await fetch(`${SKILL_HUB_BASE_URL}/${skillId}`, {
        headers: { Authorization: SKILL_HUB_AUTHORIZATION },
      });
      const data = await response.json();
      res.json({ success: true, data: data.data });
    } catch (error) {
      console.error('[SkillHub API] Failed to fetch skill detail:', error);
      res.status(500).json({ success: false, msg: error instanceof Error ? error.message : String(error) });
    }
  });
}

export default registerApiRoutes;
