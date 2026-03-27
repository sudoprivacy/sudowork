/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sudowork Server constants
 * Sudowork 中控服务器常量配置
 */

/**
 * Default Sudowork server base URL
 * Sudowork 中控服务器默认地址
 *
 * This is hardcoded to avoid issues where old config values persist
 * after code updates. The server URL should be controlled by code,
 * not by user configuration.
 */
export const SUDOWORK_SERVER_BASE_URL = 'https://sudoclaw-server.sudoprivacy.com';