/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry Encryption Keys - 遥测加密密钥配置
 *
 * 使用 RSA-2048 + AES-256-GCM 混合加密方案
 */

// ============================================================
// RSA 公钥配置
// ============================================================

/**
 * sudoclaw-qms RSA-2048 公钥
 *
 * 用于混合加密：
 * - 客户端用此公钥加密临时 AES 密钥
 * - 服务端用私钥解密 AES 密钥
 *
 * 密钥格式: PEM (SPKI DER Base64)
 *
 * 注意: 此公钥嵌入客户端代码，服务端需持有对应私钥
 */
export const TELEMETRY_PUBLIC_KEY_PEM = `
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvtxdGBwhvxH1RdEutr+p
j2JKavBazBk5lpwmmL4dF1lPrZc1NQQjaSh4CJZnSydvuWZ9Q0IUtgrKk5LmYqot
SO4D3ZesDTODcTH1R54j/76NR13lIQmcvYL+yn9FWQaRaf7WUs/I+gENEM1MYlql
g3er5ootrrkH9t9C4vHxG378pC7rFXKX0kAw03g1GgThtndZq+y7Sx1VG+djUHM+
NmJf+BK4EqeNhBW5nxBAztRxgKWRVqEgseysqznjEldJx6BddzuRr6McXilDuTGY
YBicgOr0E4jBhAtecVQOsbk2XADVSrEWGigJEZ1KJ6AP/2C2t9Om/8d/KP9w4F0H
eQIDAQAB
-----END PUBLIC KEY-----
`;

// ============================================================
// 加密配置
// ============================================================

/**
 * 加密算法配置
 */
export const ENCRYPTION_CONFIG = {
  /** 是否启用加密 (生产环境默认启用，开发环境可禁用) */
  enabled: true,

  /** 加密算法版本 */
  algorithm: 'hybrid-v1' as const,

  /** RSA 参数 */
  rsa: {
    modulusLength: 2048,
    publicExponent: 65537,
    hash: 'sha256',
    algorithm: 'RSA-OAEP',
  },

  /** AES 参数 */
  aes: {
    algorithm: 'aes-256-gcm',
    keyLength: 32, // 256 bits = 32 bytes
    nonceLength: 12, // 12 bytes for AES-GCM (recommended)
    tagLength: 16, // 16 bytes auth tag
  },
};

/**
 * 加密配置类型
 */
export interface TelemetryEncryptionOptions {
  /** 是否启用加密 */
  enabled: boolean;

  /** 加密算法版本 */
  algorithm: 'hybrid-v1';

  /** 加密失败时是否降级为明文上报 */
  fallbackToPlaintext: boolean;

  /** RSA 公钥 PEM */
  publicKeyPem: string;
}

/**
 * 默认加密选项
 */
export const DEFAULT_ENCRYPTION_OPTIONS: TelemetryEncryptionOptions = {
  enabled: ENCRYPTION_CONFIG.enabled,
  algorithm: ENCRYPTION_CONFIG.algorithm,
  fallbackToPlaintext: true, // 开发环境降级
  publicKeyPem: TELEMETRY_PUBLIC_KEY_PEM,
};