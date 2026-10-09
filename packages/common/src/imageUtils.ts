/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Known vision-capable model name prefixes.
 * Models matching these prefixes support image input.
 * Keep in sync with the model list offered by SudoRouter.
 */
const VISION_MODEL_PREFIXES = ['claude-3', 'claude-sonnet', 'claude-opus', 'gemini', 'gpt-4o', 'gpt-5', 'qwen-vl', 'llava'];

/**
 * Check if a model ID supports vision (image input) based on its name.
 */
export function isVisionModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (lower.includes('flash-lite')) return false;
  if (lower.includes('codex')) return false;
  return VISION_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower.includes(prefix.toLowerCase()));
}

/**
 * Return the `input` array for a scode model entry based on whether it supports vision.
 */
export function modelInputForModelId(modelId: string): string[] {
  return isVisionModel(modelId) ? ['text', 'image'] : ['text'];
}

/**
 * Image-capability descriptor advertised by an ACP backend via
 * `initialize` response → `_meta.sudocode.imageCapability`. Sudowork queries
 * this to right-size the bytes it ships; if a backend doesn't advertise the
 * extension, sudowork falls back to its default {@link IMAGE_TARGET_RAW_SIZE}.
 *
 * Mirror of the Rust struct in `rust/crates/runtime/src/image_registry.rs`
 * (sudocode side). See `docs/design/image-handling-non-user-facing.html`
 * Decision 1 for the wire format + spec citation (ACP `_meta` is the
 * canonical extension point per the RFD: Meta Field Propagation Conventions).
 */
export interface IImageCapability {
  maxBytes?: number;
  maxDimension?: number;
  downsampleTargetBytes?: number;
  autoHandlesOversized?: boolean;
  autoHandlesWrongModel?: boolean;
}

/**
 * Parse an ACP `initialize` response and return the advertised image
 * capability, or `null` if the backend doesn't speak the extension.
 * Per Decision 1 (hard rule): absent capability MUST fall back silently
 * to sudowork defaults; never throw, never warn.
 */
export function parseImageCapability(initResponse: unknown): IImageCapability | null {
  if (!initResponse || typeof initResponse !== 'object') return null;
  const meta = (initResponse as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object') return null;
  const sudocodeNs = (meta as Record<string, unknown>).sudocode;
  if (!sudocodeNs || typeof sudocodeNs !== 'object') return null;
  const imageCap = (sudocodeNs as Record<string, unknown>).imageCapability;
  if (!imageCap || typeof imageCap !== 'object') return null;
  const r = imageCap as Record<string, unknown>;
  return {
    maxBytes: typeof r.maxBytes === 'number' ? r.maxBytes : undefined,
    maxDimension: typeof r.maxDimension === 'number' ? r.maxDimension : undefined,
    downsampleTargetBytes: typeof r.downsampleTargetBytes === 'number' ? r.downsampleTargetBytes : undefined,
    autoHandlesOversized: typeof r.autoHandlesOversized === 'boolean' ? r.autoHandlesOversized : undefined,
    autoHandlesWrongModel: typeof r.autoHandlesWrongModel === 'boolean' ? r.autoHandlesWrongModel : undefined,
  };
}

/** Economy-mode hard cap. When the user opts in, we clamp here regardless of model. */
const ECONOMY_MODE_TARGET = 128 * 1024;

/**
 * Resolve the target raw-bytes cap for image downsampling.
 *
 * Resolution order:
 *  1. `opts.economyMode === true` → 128 KB (user-opt-in for cost-sensitive plans)
 *  2. `opts.capability.downsampleTargetBytes` → backend-advertised value
 *  3. {@link IMAGE_TARGET_RAW_SIZE} (512 KB sudowork default)
 *
 * `modelId` is kept on the signature for callers that still pass it (no longer
 * referenced — the old `gemini|claude → 128KB` heuristic was an arbitrary
 * empirical value, replaced by model-driven caps per Decision 3 of the design
 * doc `docs/design/image-handling-non-user-facing.html`).
 */
export function getImageTargetSize(_modelId: string | null | undefined, opts?: { capability?: IImageCapability | null; economyMode?: boolean }): number {
  if (opts?.economyMode) return ECONOMY_MODE_TARGET;
  const advertised = opts?.capability?.downsampleTargetBytes;
  return typeof advertised === 'number' && advertised > 0 ? advertised : IMAGE_TARGET_RAW_SIZE;
}

/**
 * Detect image MIME type from magic bytes.
 * Returns null if the buffer does not match any known image format.
 */
export function detectImageMimeType(buffer: Buffer | Uint8Array): { mime: string; ext: string } | null {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  return null;
}

// ── Image size limits ────────────────────────────────────────────────
// These limits balance image quality vs. context window consumption.
// Vision models work well with 1280px images at ~512KB;
// larger images waste tokens without meaningful quality improvement.

/** Maximum base64-encoded size (5 MB) — hard API limit, used as last-resort bound */
export const IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024;

/** Target raw byte size for compressed images (512 KB) — small enough for context */
export const IMAGE_TARGET_RAW_SIZE = 512 * 1024;

/** Maximum client-side image dimensions — 1280px is optimal for vision models */
export const IMAGE_MAX_WIDTH = 1280;
export const IMAGE_MAX_HEIGHT = 1280;

export interface ResizeResult {
  buffer: Buffer;
  mediaType: string;
  originalWidth?: number;
  originalHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
}

/**
 * Resize and compress an image buffer to meet size and dimension constraints.
 *
 * Strategy (following moss imageResizer):
 * 1. Fast path: if within size & dimension limits, return as-is
 * 2. Compression-only: if dimensions OK but size exceeds limit, try PNG palette compression,
 *    then progressive JPEG quality 80→60→40→20
 * 3. Dimension resize: constrain to IMAGE_MAX_WIDTH × IMAGE_MAX_HEIGHT maintaining aspect ratio,
 *    then compress if still over size limit
 * 4. Last resort: max 800px wide, JPEG quality 20
 * 5. Fallback on sharp failure: pass through if base64 size is under API limit
 */
export async function resizeImageForContext(imageBuffer: Buffer, maxBytes: number = IMAGE_TARGET_RAW_SIZE): Promise<ResizeResult> {
  if (imageBuffer.length === 0) {
    return { buffer: imageBuffer, mediaType: 'image/png' };
  }

  const detected = detectImageMimeType(imageBuffer);
  const mediaType = detected?.mime ?? 'image/png';

  // Fast path: small enough and we can't check dimensions without sharp
  // but try sharp first
  try {
    const sharp = await importSharp();
    if (!sharp) {
      // sharp unavailable — pass through if under base64 limit
      return passThroughOrError(imageBuffer, mediaType);
    }

    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      if (imageBuffer.length > maxBytes) {
        const compressed = await sharp(imageBuffer).jpeg({ quality: 80 }).toBuffer();
        return { buffer: compressed, mediaType: 'image/jpeg' };
      }
      return { buffer: imageBuffer, mediaType };
    }

    const originalWidth = metadata.width;
    const originalHeight = metadata.height;
    const format = metadata.format ?? detected?.ext ?? 'png';
    const normalizedMediaType = format === 'jpg' ? 'jpeg' : format;

    // Fast path: already within limits
    if (imageBuffer.length <= maxBytes && originalWidth <= IMAGE_MAX_WIDTH && originalHeight <= IMAGE_MAX_HEIGHT) {
      return {
        buffer: imageBuffer,
        mediaType: `image/${normalizedMediaType}`,
        originalWidth,
        originalHeight,
        displayWidth: originalWidth,
        displayHeight: originalHeight,
      };
    }

    const isPng = normalizedMediaType === 'png';
    const needsDimensionResize = originalWidth > IMAGE_MAX_WIDTH || originalHeight > IMAGE_MAX_HEIGHT;

    // Compression-only path (dimensions OK but file too large)
    if (!needsDimensionResize && imageBuffer.length > maxBytes) {
      if (isPng) {
        const pngCompressed = await sharp(imageBuffer).png({ compressionLevel: 9, palette: true }).toBuffer();
        if (pngCompressed.length <= maxBytes) {
          return {
            buffer: pngCompressed,
            mediaType: 'image/png',
            originalWidth,
            originalHeight,
            displayWidth: originalWidth,
            displayHeight: originalHeight,
          };
        }
      }
      for (const quality of [80, 60, 40, 20] as const) {
        const compressed = await sharp(imageBuffer).jpeg({ quality }).toBuffer();
        if (compressed.length <= maxBytes) {
          return {
            buffer: compressed,
            mediaType: 'image/jpeg',
            originalWidth,
            originalHeight,
            displayWidth: originalWidth,
            displayHeight: originalHeight,
          };
        }
      }
    }

    // Dimension resize
    let width = originalWidth;
    let height = originalHeight;
    if (width > IMAGE_MAX_WIDTH) {
      height = Math.round((height * IMAGE_MAX_WIDTH) / width);
      width = IMAGE_MAX_WIDTH;
    }
    if (height > IMAGE_MAX_HEIGHT) {
      width = Math.round((width * IMAGE_MAX_HEIGHT) / height);
      height = IMAGE_MAX_HEIGHT;
    }

    const resized = await sharp(imageBuffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).toBuffer();

    // Post-resize compression if still over size limit
    if (resized.length > maxBytes) {
      if (isPng) {
        const pngCompressed = await sharp(imageBuffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
        if (pngCompressed.length <= maxBytes) {
          return {
            buffer: pngCompressed,
            mediaType: 'image/png',
            originalWidth,
            originalHeight,
            displayWidth: width,
            displayHeight: height,
          };
        }
      }

      for (const quality of [80, 60, 40, 20] as const) {
        const compressed = await sharp(imageBuffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
        if (compressed.length <= maxBytes) {
          return {
            buffer: compressed,
            mediaType: 'image/jpeg',
            originalWidth,
            originalHeight,
            displayWidth: width,
            displayHeight: height,
          };
        }
      }

      // Last resort: smaller dimensions, aggressive JPEG compression
      const smallerWidth = Math.min(width, 800);
      const smallerHeight = Math.round((height * smallerWidth) / Math.max(width, 1));
      const ultraCompressed = await sharp(imageBuffer).resize(smallerWidth, smallerHeight, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 20 }).toBuffer();
      return {
        buffer: ultraCompressed,
        mediaType: 'image/jpeg',
        originalWidth,
        originalHeight,
        displayWidth: smallerWidth,
        displayHeight: smallerHeight,
      };
    }

    return {
      buffer: resized,
      mediaType: `image/${normalizedMediaType}`,
      originalWidth,
      originalHeight,
      displayWidth: width,
      displayHeight: height,
    };
  } catch {
    // sharp failed — pass through if base64 size is under API limit
    return passThroughOrError(imageBuffer, mediaType);
  }
}

function passThroughOrError(imageBuffer: Buffer, mediaType: string): ResizeResult {
  const base64Size = Math.ceil((imageBuffer.length * 4) / 3);
  if (base64Size <= IMAGE_MAX_BASE64_SIZE) {
    return { buffer: imageBuffer, mediaType };
  }
  // Still return it — the caller will handle the oversized case
  console.warn(`[ImageResize] Image too large (${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB raw, ${(base64Size / 1024 / 1024).toFixed(1)}MB base64) and compression failed. Passing through.`);
  return { buffer: imageBuffer, mediaType };
}

/**
 * Import sharp dynamically. Returns null if sharp is not available.
 */
let _sharp: typeof import('sharp') | null | undefined;
async function importSharp(): Promise<typeof import('sharp') | null> {
  if (_sharp === undefined) {
    try {
      _sharp = (await import('sharp')).default;
    } catch {
      _sharp = null;
    }
  }
  return _sharp;
}
