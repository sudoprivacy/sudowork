/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hard cap on the base64 size of any single image content block sudowork will
 * hand to the ACP transport. Above this, the gRPC frame / Node IPC channel
 * for `session/prompt` can stall and the renderer's processing indicator
 * gets stuck forever (no error response → no `finish` event → no spinner
 * reset). The 300s `session/prompt` timeout in AcpConnection is NOT a
 * reliable backstop here: it only fires once the RPC actually dispatched,
 * but oversized writes can wedge inside the gRPC writer queue.
 *
 * Why 25MB:
 *  - sudocode's own image preflight (`image_registry.rs MAX_IMAGE_BYTES`)
 *    caps the LLM-side payload at 5MB; this client-side number is the
 *    TRANSPORT-side cap and is intentionally looser (5× headroom) so that
 *    large screenshots still flow through and get downsampled server-side.
 *  - Empirically (2026-06-28 ai-dev-browser drive of conv 78d6e31c):
 *    2 × 52MB base64 images → gRPC `session/prompt` hung indefinitely,
 *    the 300s connection-timeout never fired, the spinner stuck at 9m+.
 *  - 25MB is comfortably under typical gRPC default `max_send_message_size`
 *    (256MB) and well above any single typical screenshot.
 *
 * Duplication-vs-SSOT note: this cap exists ALONGSIDE sudocode's
 * `image_registry.rs MAX_IMAGE_BYTES` (5MB). They serve different concerns —
 * sudocode's is the LLM-side preflight cap; this one is the transport-side
 * pre-flight cap. Intentional defense in depth, not an SSOT violation.
 */
export const IMAGE_ATTACHMENT_TRANSPORT_CAP_BYTES = 25 * 1024 * 1024;

/**
 * Shape of an image content block as it travels through AcpAgent / ACP.
 * Just enough fields to size-validate without coupling to the full schema.
 */
export interface ImageBlockForValidation {
  /** base64-encoded image bytes (NOT the raw image; what actually ships over the wire). */
  data: string;
  /** MIME type, kept for diagnostic messages. */
  mimeType: string;
}

/**
 * Human-readable size formatter. Returns `"25.1 MB"`, `"190 KB"`, etc.
 * Local to this module (`formatBytesForMessage` in AcpAgent isn't exported
 * and copying would lose the SSOT we just established).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Validate that every image's base64 size fits the transport cap. Returns
 * a user-facing message describing the first oversize image, or `null` when
 * all images are within cap.
 *
 * Returns early on the FIRST oversize image. Per-image rather than total
 * because clients usually paste images one at a time; the per-image message
 * gives clearer guidance than a "total exceeds" aggregate.
 *
 * @example
 * const error = validateImageAttachmentSize([{ data: bigB64, mimeType: 'image/png' }]);
 * if (error) { ui.showError(error); return; }
 */
export function validateImageAttachmentSize(images: ImageBlockForValidation[] | undefined | null, cap: number = IMAGE_ATTACHMENT_TRANSPORT_CAP_BYTES): string | null {
  if (!images || images.length === 0) return null;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (img.data.length > cap) {
      // Stopgap message — the SOTA fix is server-side auto-downsample /
      // auto-VLM-routing so users never see this. Tracked at:
      // https://s.shareone.vip/s/sudo-code-roadmap (search "image too large")
      // For now we surface a soft message so the user knows what happened
      // and the renderer's processing indicator clears (this guard's
      // primary job is preventing the gRPC transport from wedging when
      // base64 > 25MB, which would leave the spinner stuck forever).
      return `图片 #${i + 1} 太大了 (约 ${formatBytes(img.data.length)}，临时上限 ${formatBytes(cap)})。可以先用其他工具压一下；这个限制是临时的，之后版本会在后端自动处理。`;
    }
  }

  return null;
}
