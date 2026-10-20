import { describe, expect, it } from 'vitest';
import { addBrowserFrameCoordinateHint } from '../../src/process/services/browserPanel/LocalBrowserSessions';

function jpeg(width: number, height: number): string {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9]).toString('base64');
}

describe('addBrowserFrameCoordinateHint', () => {
  it('places native screenshot dimensions immediately before the image', () => {
    const response = addBrowserFrameCoordinateHint({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          { type: 'text', text: '{"session":{}}' },
          { type: 'image', mimeType: 'image/jpeg', data: jpeg(1280, 674) },
        ],
      },
    }) as { result: { content: Array<{ type: string; text?: string }> } };

    expect(response.result.content).toHaveLength(3);
    expect(response.result.content[1]).toEqual({
      type: 'text',
      text: JSON.stringify({
        screenshotPixelDimensions: {
          width: 1280,
          height: 674,
        },
        browserInputCoordinates: {
          unit: 'css-pixel',
          instruction:
            'Do not pass raw screenshot pixel positions to browser_action. First call browser_action command with method Runtime.evaluate and paramsJson {"expression":"({width:innerWidth,height:innerHeight,devicePixelRatio})","returnByValue":true}; divide screenshot x and y by the returned devicePixelRatio before clicking or scrolling.',
        },
      }),
    });
    expect(response.result.content[2]?.type).toBe('image');
  });

  it('leaves responses without a valid JPEG image unchanged', () => {
    const response = { result: { content: [{ type: 'text', text: 'ok' }] } };
    expect(addBrowserFrameCoordinateHint(response)).toBe(response);
  });
});
