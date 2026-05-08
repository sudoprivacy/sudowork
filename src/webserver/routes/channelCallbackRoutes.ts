/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Express, Request, Response } from 'express';

import { ChannelManager } from '@/channels/core/ChannelManager';
import type { WeComAppPlugin } from '@/channels/plugins/wecom-app/WeComAppPlugin';

/**
 * Register HTTP callback routes for channel plugins that deliver messages /
 * events via webhook. Currently used by the WeCom 自建应用 plugin.
 *
 * Endpoints:
 *   GET  /wecom-app/callback/:pluginId  → URL verification handshake
 *   POST /wecom-app/callback/:pluginId  → Inbound messages + events
 *
 * These routes are intentionally unauthenticated — WeCom's msg_signature
 * parameter is the authentication mechanism and is verified by the plugin.
 * Rate limiting is also skipped (WeCom retries aggressively on 4xx/5xx).
 */
export function registerChannelCallbackRoutes(app: Express): void {
  const handler = async (req: Request, res: Response) => {
    const rawPluginId = req.params.pluginId;
    const pluginId = Array.isArray(rawPluginId) ? rawPluginId[0] : rawPluginId;
    if (!pluginId) {
      res.status(400).send('missing pluginId');
      return;
    }
    const manager = ChannelManager.getInstance();
    const pluginManager = manager.getPluginManager();
    const plugin = pluginManager?.getPlugin(pluginId);
    if (!plugin) {
      res.status(404).send('plugin not found');
      return;
    }
    if (plugin.type !== 'wecom-app' || typeof (plugin as WeComAppPlugin).handleCallback !== 'function') {
      res.status(400).send('unsupported plugin type');
      return;
    }
    try {
      await (plugin as WeComAppPlugin).handleCallback(req, res);
    } catch (error) {
      console.error('[channelCallbackRoutes] handler failed:', error);
      if (!res.headersSent) {
        res.status(500).send('error');
      }
    }
  };

  app.get('/wecom-app/callback/:pluginId', handler);
  app.post('/wecom-app/callback/:pluginId', handler);
}
