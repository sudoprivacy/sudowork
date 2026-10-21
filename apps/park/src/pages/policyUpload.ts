export const POLICY_FILE_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx', '.pdf'] as const
export const POLICY_FILE_ACCEPT = POLICY_FILE_EXTENSIONS.join(',')
export const POLICY_FILE_MAX_BYTES = 50 * 1024 * 1024

export function isPolicyFileName(fileName: string): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return POLICY_FILE_EXTENSIONS.some((value) => value === extension)
}
