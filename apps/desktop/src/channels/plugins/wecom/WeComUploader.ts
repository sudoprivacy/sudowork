/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { WeComUploadType } from './WeComAdapter';

/**
 * WeComUploader - Handles file upload via WeCom WebSocket long connection
 *
 * Implements three-step chunked upload:
 * 1. aibot_upload_media_init - Get upload_id
 * 2. aibot_upload_media_chunk - Upload base64 data (multiple chunks, ≤512KB each)
 * 3. aibot_upload_media_finish - Get media_id
 *
 * Reference: https://developer.work.weixin.qq.com/document/path/101463
 */

// Maximum chunk size before base64 encoding (512KB)
const MAX_CHUNK_SIZE = 512 * 1024;

// Maximum number of chunks (100)
const MAX_CHUNKS = 100;

// File size limits by type
const SIZE_LIMITS: Record<WeComUploadType, number> = {
  image: 10 * 1024 * 1024, // 10MB
  voice: 2 * 1024 * 1024, // 2MB
  video: 10 * 1024 * 1024, // 10MB
  file: 20 * 1024 * 1024, // 20MB
};

// Supported file formats by type
const SUPPORTED_FORMATS: Record<WeComUploadType, Set<string>> = {
  image: new Set(['.png', '.jpg', '.jpeg', '.gif']),
  voice: new Set(['.amr']),
  video: new Set(['.mp4']),
  file: new Set(), // All formats supported
};

/**
 * WebSocket message response handler
 */
interface WsResponse {
  errcode: number;
  errmsg: string;
  body?: {
    upload_id?: string;
    media_id?: string;
  };
}

/**
 * WeComUploader class
 */
export class WeComUploader {
  private pendingResponses: Map<string, { resolve: (value: WsResponse) => void; reject: (error: Error) => void }> = new Map();
  private responseTimeout = 30000; // 30 seconds

  constructor(
    private send: (data: Record<string, unknown>) => void,
    private generateReqId: () => string
  ) {}

  /**
   * Handle WebSocket response for upload commands
   * Called by WeComPlugin when receiving upload-related responses
   */
  handleResponse(msg: Record<string, unknown>): void {
    const reqId = (msg.headers as Record<string, unknown>)?.req_id as string;
    if (!reqId) return;

    const pending = this.pendingResponses.get(reqId);
    if (!pending) return;

    const errcode = msg.errcode as number;
    const errmsg = (msg.errmsg as string) || '';

    if (errcode === 0) {
      pending.resolve({
        errcode,
        errmsg,
        body: msg.body as { upload_id?: string; media_id?: string } | undefined,
      });
    } else {
      pending.reject(new Error(`WeCom upload error: ${errmsg} (errcode=${errcode})`));
    }

    this.pendingResponses.delete(reqId);
  }

  /**
   * Upload a file to WeCom and return media_id
   *
   * @param filePath - Local file path
   * @param type - Upload type (image/file/voice/video)
   * @returns media_id for use in message sending
   */
  async uploadFile(filePath: string, type: WeComUploadType): Promise<string> {
    // Validate file
    this.validateFile(filePath, type);

    // Read file content
    const content = fs.readFileSync(filePath);
    const totalSize = content.length;
    const filename = path.basename(filePath);

    // Calculate MD5
    const md5 = crypto.createHash('md5').update(content).digest('hex');

    // Split into chunks
    const chunks = this.splitFile(content);
    const totalChunks = chunks.length;

    console.log(`[WeComUploader] Uploading: file=${filename}, type=${type}, size=${totalSize}, chunks=${totalChunks}, md5=${md5}`);

    // Step 1: Initialize upload
    const uploadId = await this.initUpload(type, filename, totalSize, totalChunks, md5);

    // Step 2: Upload chunks
    for (let i = 0; i < chunks.length; i++) {
      await this.uploadChunk(uploadId, i, chunks[i]);
      console.log(`[WeComUploader] Chunk ${i + 1}/${totalChunks} uploaded`);
    }

    // Step 3: Finish upload
    const mediaId = await this.finishUpload(uploadId);

    console.log(`[WeComUploader] Upload complete: media_id=${mediaId}`);
    return mediaId;
  }

  /**
   * Validate file before upload
   */
  private validateFile(filePath: string, type: WeComUploadType): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const sizeLimit = SIZE_LIMITS[type];
    const supportedFormats = SUPPORTED_FORMATS[type];

    // Check size
    if (stat.size > sizeLimit) {
      throw new Error(`File too large: ${stat.size} bytes exceeds ${sizeLimit} limit for type ${type}`);
    }

    // Check format
    if (supportedFormats.size > 0 && !supportedFormats.has(ext)) {
      throw new Error(`Unsupported format: ${ext} for type ${type}. Supported: ${Array.from(supportedFormats).join(', ')}`);
    }

    // Check minimum size (5 bytes per API doc)
    if (stat.size < 5) {
      throw new Error(`File too small: minimum 5 bytes required`);
    }
  }

  /**
   * Split file content into chunks
   */
  private splitFile(content: Buffer): Buffer[] {
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < content.length) {
      const chunkSize = Math.min(MAX_CHUNK_SIZE, content.length - offset);
      chunks.push(content.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    }

    if (chunks.length > MAX_CHUNKS) {
      throw new Error(`Too many chunks: ${chunks.length} exceeds ${MAX_CHUNKS} limit. File is too large.`);
    }

    return chunks;
  }

  /**
   * Step 1: Initialize upload
   */
  private async initUpload(type: WeComUploadType, filename: string, totalSize: number, totalChunks: number, md5: string): Promise<string> {
    const reqId = this.generateReqId();

    const request = {
      cmd: 'aibot_upload_media_init',
      headers: { req_id: reqId },
      body: {
        type,
        filename,
        total_size: totalSize,
        total_chunks: totalChunks,
        md5,
      },
    };

    const response = await this.sendAndWait(reqId, request);
    const uploadId = response.body?.upload_id;

    if (!uploadId) {
      throw new Error('WeCom upload init failed: no upload_id returned');
    }

    return uploadId;
  }

  /**
   * Step 2: Upload a chunk
   */
  private async uploadChunk(uploadId: string, chunkIndex: number, chunk: Buffer): Promise<void> {
    const reqId = this.generateReqId();

    // Base64 encode the chunk
    const base64Data = chunk.toString('base64');

    const request = {
      cmd: 'aibot_upload_media_chunk',
      headers: { req_id: reqId },
      body: {
        upload_id: uploadId,
        chunk_index: chunkIndex,
        base64_data: base64Data,
      },
    };

    await this.sendAndWait(reqId, request);
  }

  /**
   * Step 3: Finish upload
   */
  private async finishUpload(uploadId: string): Promise<string> {
    const reqId = this.generateReqId();

    const request = {
      cmd: 'aibot_upload_media_finish',
      headers: { req_id: reqId },
      body: {
        upload_id: uploadId,
      },
    };

    const response = await this.sendAndWait(reqId, request);
    const mediaId = response.body?.media_id;

    if (!mediaId) {
      throw new Error('WeCom upload finish failed: no media_id returned');
    }

    return mediaId;
  }

  /**
   * Send request and wait for response
   */
  private sendAndWait(reqId: string, request: Record<string, unknown>): Promise<WsResponse> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(reqId);
        reject(new Error(`WeCom upload timeout: no response for req_id=${reqId}`));
      }, this.responseTimeout);

      // Store pending response handler
      this.pendingResponses.set(reqId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      // Send request
      this.send(request);
    });
  }

  /**
   * Clear all pending responses (for cleanup)
   */
  clearPending(): void {
    for (const [_, pending] of this.pendingResponses) {
      pending.reject(new Error('WeComUploader cleared'));
    }
    this.pendingResponses.clear();
  }
}
