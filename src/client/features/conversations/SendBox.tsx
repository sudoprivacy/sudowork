import React, { useRef, useState, type ChangeEvent, type FormEvent } from 'react'

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_IMAGES = 4

export interface PendingImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
}

export function SendBox({
  disabled,
  disabledReason,
  onSend,
}: {
  disabled: boolean
  disabledReason?: string
  onSend: (text: string, images: PendingImage[]) => void
}): React.ReactElement {
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFiles(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    setError(null)
    const files = Array.from(e.target.files ?? [])
    const next: PendingImage[] = []
    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        setError('仅支持 PNG/JPEG/WebP 图片')
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('单张图片不能超过 10MB')
        continue
      }
      const data = await readAsBase64(file)
      next.push({ mediaType: file.type as PendingImage['mediaType'], data })
    }
    setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES))
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed, images)
    setText('')
    setImages([])
  }

  return (
    <form className='shrink-0 border-t border-light p-3 flex flex-col gap-2' onSubmit={handleSubmit}>
      {images.length > 0 ? (
        <div className='flex gap-2 text-12px text-secondary'>
          {images.map((img, i) => (
            <span key={i} className='rd-1 bg-faint px-2 py-0.5'>
              🖼 {img.mediaType}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className='text-12px text-danger'>{error}</div> : null}
      <div className='flex items-end gap-2'>
        <label className='shrink-0 size-9 f-center rd-2 border border-light cursor-pointer text-secondary hover:bg-hover' title='添加图片'>
          📎
          <input
            ref={fileRef}
            type='file'
            accept='image/png,image/jpeg,image/webp'
            multiple
            className='hidden'
            onChange={(e) => void handleFiles(e)}
          />
        </label>
        <textarea
          className='flex-1 resize-none rd-2 border border-light px-3 py-2 text-14px bg-base'
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? (disabledReason ?? '只读') : '输入消息，Enter 发送'}
          aria-label='消息输入框'
        />
        <button
          type='submit'
          className='shrink-0 px-4 py-2 rd-2 bg-[var(--primary)] text-white text-14px disabled:opacity-50'
          disabled={disabled || !text.trim()}
        >
          发送
        </button>
      </div>
    </form>
  )
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
