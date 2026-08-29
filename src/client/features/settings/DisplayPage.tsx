import React, { useEffect, useState } from 'react'
import { Button, Message, Radio, Slider } from '@arco-design/web-react'
import { settingsApi, type DisplaySettings } from './settingsApi'

/** 显示设置（计划 Task 8）：主题与字号存 PostgreSQL（多用户隔离）。 */
export function DisplayPage(): React.ReactElement {
  const [settings, setSettings] = useState<DisplaySettings>({ theme: 'system', fontScale: 1 })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void settingsApi.getDisplay().then((s) => {
      setSettings(s)
      setLoaded(true)
    })
  }, [])

  async function handleSave(): Promise<void> {
    setSaving(true)
    try {
      await settingsApi.putDisplay(settings)
      Message.success('已保存')
    } catch {
      Message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='size-full overflow-y-auto p-6' data-testid='display-page'>
      <div className='max-w-xl mx-auto flex flex-col gap-5'>
        <h1 className='text-20px font-700 m-0'>显示</h1>

        <section className='flex flex-col gap-2'>
          <div className='text-14px font-600'>主题</div>
          <Radio.Group
            type='button'
            value={settings.theme}
            onChange={(v) => setSettings((s) => ({ ...s, theme: v as DisplaySettings['theme'] }))}
            disabled={!loaded}
          >
            <Radio value='system'>跟随系统</Radio>
            <Radio value='light'>浅色</Radio>
            <Radio value='dark'>深色</Radio>
          </Radio.Group>
        </section>

        <section className='flex flex-col gap-2'>
          <div className='text-14px font-600'>字号缩放（{settings.fontScale.toFixed(2)}x）</div>
          <Slider
            min={0.75}
            max={1.5}
            step={0.05}
            value={settings.fontScale}
            onChange={(v) => setSettings((s) => ({ ...s, fontScale: Number(v) }))}
            disabled={!loaded}
          />
        </section>

        <div>
          <Button type='primary' size='small' loading={saving} disabled={!loaded} onClick={() => void handleSave()}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
