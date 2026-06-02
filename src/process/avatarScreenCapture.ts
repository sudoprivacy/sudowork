/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { desktopCapturer, screen } from 'electron';
import { mainError } from './utils/mainLogger';

const CROP_SIZE = 800;

export type ScreenCaptureResult = {
  /** Base64-encoded JPEG of the 800×800 crop */
  imageBase64: string;
  /** Cursor position at capture time (screen coordinates) */
  cursorX: number;
  cursorY: number;
  /** The crop rectangle in screen coordinates */
  cropRect: { x: number; y: number; width: number; height: number };
};

/**
 * Capture an 800×800 region around the given cursor position.
 *
 * Uses Electron desktopCapturer to grab the primary display, then crops
 * to CROP_SIZE×CROP_SIZE centered on the cursor. The crop is clamped to
 * screen bounds.
 *
 * Returns a base64 JPEG suitable for sending to Gemini Live as a video frame.
 */
export async function captureAroundCursor(cursorPos: {
  x: number;
  y: number;
}): Promise<ScreenCaptureResult | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: getDisplaySize(),
    });

    if (sources.length === 0) {
      mainError('AvatarCapture', 'No screen sources available');
      return null;
    }

    // Use primary display source
    const source = sources[0];
    const thumbnail = source.thumbnail;

    if (thumbnail.isEmpty()) {
      mainError('AvatarCapture', 'Thumbnail is empty');
      return null;
    }

    // Compute crop rectangle centered on cursor, clamped to image bounds
    const imgSize = thumbnail.getSize();
    const display = screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor;

    // Convert screen coordinates to image pixel coordinates
    const imgX = (cursorPos.x - display.bounds.x) * scaleFactor;
    const imgY = (cursorPos.y - display.bounds.y) * scaleFactor;
    const cropPixels = CROP_SIZE * scaleFactor;

    // Center the crop on cursor, clamp to image bounds
    let cropX = Math.round(imgX - cropPixels / 2);
    let cropY = Math.round(imgY - cropPixels / 2);
    cropX = Math.max(0, Math.min(cropX, imgSize.width - cropPixels));
    cropY = Math.max(0, Math.min(cropY, imgSize.height - cropPixels));
    const cropW = Math.min(cropPixels, imgSize.width);
    const cropH = Math.min(cropPixels, imgSize.height);

    const cropped = thumbnail.crop({
      x: cropX,
      y: cropY,
      width: cropW,
      height: cropH,
    });

    // Resize to 800×800 logical pixels for consistent token cost
    const resized = cropped.resize({ width: CROP_SIZE, height: CROP_SIZE });
    const jpegBuffer = resized.toJPEG(80);
    const imageBase64 = jpegBuffer.toString('base64');

    return {
      imageBase64,
      cursorX: cursorPos.x,
      cursorY: cursorPos.y,
      cropRect: {
        x: Math.round(cropX / scaleFactor + display.bounds.x),
        y: Math.round(cropY / scaleFactor + display.bounds.y),
        width: CROP_SIZE,
        height: CROP_SIZE,
      },
    };
  } catch (error) {
    mainError('AvatarCapture', 'Screen capture failed:', error);
    return null;
  }
}

function getDisplaySize(): { width: number; height: number } {
  const display = screen.getPrimaryDisplay();
  return {
    width: display.size.width * display.scaleFactor,
    height: display.size.height * display.scaleFactor,
  };
}
