export const MAX_LOGO_BYTES = 500 * 1024
export const LOGO_ACCEPT = '.jpg,.jpeg,.svg,.png'

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  png: 'image/png',
}

export function isValidLogo(file: File): boolean {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  return !!MIME_BY_EXTENSION[extension] && file.size > 0 && file.size <= MAX_LOGO_BYTES
}

export async function encodeLogo(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    file_name: file.name,
    mime_type: MIME_BY_EXTENSION[file.name.split('.').at(-1)?.toLowerCase() ?? ''],
    content_base64: btoa(binary),
  }
}
