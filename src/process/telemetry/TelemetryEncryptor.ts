/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TelemetryEncryptor - 混合加密器
 *
 * 使用 RSA-2048 + AES-256-GCM 混合加密方案：
 * - 每次上报生成临时 AES-256-GCM 对称密钥
 * - 用 RSA-2048 公钥加密 AES 密钥
 * - 用 AES 密钥加密请求体
 * - 服务端用 RSA 私钥解密 AES 密钥，再解密请求体
 *
 * Node.js 环境实现 (Electron 主进程)
 */

import * as crypto from 'crypto';
import { TELEMETRY_PUBLIC_KEY_PEM, ENCRYPTION_CONFIG } from './keys';
import { mainLog, mainWarn, mainError } from '../utils/mainLogger';

// ============================================================
// 类型定义
// ============================================================

/**
 * 加密后的请求结构
 */
export interface EncryptedPayload {
  /** RSA-OAEP 加密的 AES-256 密钥 (Base64 编码) */
  encrypted_key: string;

  /** AES-256-GCM 加密的原始请求体 (Base64 编码) */
  encrypted_data: string;

  /** AES-GCM 的 Nonce/IV (12 bytes, Base64 编码) */
  nonce: string;

  /** AES-GCM 的认证标签 (16 bytes, Base64 编码) */
  tag: string;

  /** 加密算法版本 (用于后续算法升级) */
  algorithm: 'hybrid-v1';

  /** 客户端时间戳 (用于服务端校验) */
  timestamp: number;
}

// ============================================================
// TelemetryEncryptor 类
// ============================================================

/**
 * 遥测混合加密器
 *
 * 单例模式，管理 RSA 公钥导入和加密操作
 */
export class TelemetryEncryptor {
  private static instance: TelemetryEncryptor | null = null;

  private publicKey: crypto.KeyObject | null = null;
  private initialized = false;
  private enabled = ENCRYPTION_CONFIG.enabled;

  /** 私有构造函数 */
  private constructor() {}

  /** 获取单例实例 */
  public static getInstance(): TelemetryEncryptor {
    if (!TelemetryEncryptor.instance) {
      TelemetryEncryptor.instance = new TelemetryEncryptor();
    }
    return TelemetryEncryptor.instance;
  }

  /**
   * 初始化加密器 - 导入 RSA 公钥
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // 解析 PEM 格式公钥
      const pemKey = TELEMETRY_PUBLIC_KEY_PEM.trim();

      // 检查是否为占位符密钥
      if (pemKey.includes('PlaceholderPublicKeyContent') || pemKey.includes('ExampleKeyForDevelopment')) {
        mainWarn('TelemetryEncryptor', 'Using placeholder public key - encryption disabled');
        this.enabled = false;
        this.initialized = true;
        return;
      }

      // 导入 RSA 公钥
      this.publicKey = crypto.createPublicKey({
        key: pemKey,
        format: 'pem',
        type: 'spki',
      });

      // 验证密钥类型
      if (this.publicKey.type !== 'public') {
        throw new Error('Invalid key type: expected public key');
      }

      this.initialized = true;
      mainLog('TelemetryEncryptor', 'Initialized with RSA-2048 public key');
    } catch (error) {
      mainError('TelemetryEncryptor', 'Failed to initialize:', error);
      // 初始化失败时禁用加密
      this.enabled = false;
      this.initialized = true;
    }
  }

  /**
   * 加密请求体
   *
   * @param data - 原始请求数据 (将被 JSON 序列化)
   * @returns 加密后的 payload，如果加密失败返回 null
   */
  public encrypt(data: unknown): EncryptedPayload | null {
    if (!this.enabled || !this.publicKey) {
      return null;
    }

    try {
      const config = ENCRYPTION_CONFIG;

      // Step 1: 生成临时 AES-256 密钥 (32 bytes)
      const aesKey = crypto.randomBytes(config.aes.keyLength);

      // Step 2: 生成随机 nonce (12 bytes for AES-GCM)
      const nonce = crypto.randomBytes(config.aes.nonceLength);

      // Step 3: 序列化请求体
      const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');

      // Step 4: AES-256-GCM 加密
      // Note: AES-GCM auth tag length is fixed at 16 bytes, no need to specify
      const cipher = crypto.createCipheriv(config.aes.algorithm, aesKey, nonce) as crypto.CipherGCM;

      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      // Step 5: RSA-OAEP 加密 AES 密钥
      const encryptedKey = crypto.publicEncrypt(
        {
          key: this.publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: config.rsa.hash,
        },
        aesKey,
      );

      // Step 6: Base64 编码
      return {
        encrypted_key: encryptedKey.toString('base64'),
        encrypted_data: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        tag: tag.toString('base64'),
        algorithm: config.algorithm,
        timestamp: Date.now(),
      };
    } catch (error) {
      mainError('TelemetryEncryptor', 'Encryption failed:', error);
      return null;
    }
  }

  /**
   * 检查是否已初始化
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 检查加密是否启用
   */
  public isEnabled(): boolean {
    return this.enabled && this.publicKey !== null;
  }

  /**
   * 设置启用状态
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 获取加密状态
   */
  public getStatus(): {
    initialized: boolean;
    enabled: boolean;
    hasPublicKey: boolean;
    algorithm: string;
  } {
    return {
      initialized: this.initialized,
      enabled: this.enabled,
      hasPublicKey: this.publicKey !== null,
      algorithm: ENCRYPTION_CONFIG.algorithm,
    };
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取加密器实例 */
export const getTelemetryEncryptor = (): TelemetryEncryptor => {
  return TelemetryEncryptor.getInstance();
};

/** 初始化加密器 */
export const initTelemetryEncryptor = async (): Promise<void> => {
  await getTelemetryEncryptor().initialize();
};

/** 加密数据 */
export const encryptTelemetryPayload = (data: unknown): EncryptedPayload | null => {
  return getTelemetryEncryptor().encrypt(data);
};

/** 检查加密是否可用 */
export const isEncryptionAvailable = (): boolean => {
  return getTelemetryEncryptor().isEnabled();
};