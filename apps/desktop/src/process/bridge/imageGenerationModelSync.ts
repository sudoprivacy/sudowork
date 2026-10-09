/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';

/**
 * Write agents.defaults.imageGenerationModel into an existing sudoclaw.json.
 *
 * The image-generation tool (resolveImageConfig) reads this field first, so the
 * settings page must keep it in sync — otherwise the running tool keeps using
 * the previously synced model. The model id is stored plain (no provider prefix),
 * matching ServiceManager.syncImageModelToSudoclaw; an empty string means "off".
 *
 * No-op when the file does not exist yet, to avoid creating a malformed config
 * before the gateway has written its own.
 */
export function writeSudoclawImageGenerationModel(modelId: string, configPath: string): void {
  if (!fs.existsSync(configPath)) return;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  config.agents.defaults.imageGenerationModel = modelId;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
