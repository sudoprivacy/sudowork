import React, { useEffect, useRef, useState } from 'react';
import { Button, Divider, Input, Message, Modal } from '@arco-design/web-react';
import { IconCheck } from '@arco-design/web-react/icon';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import profileBoy from '@/renderer/assets/profile_boy.jpg';
import profileGirl from '@/renderer/assets/profile_girl.jpg';
import avatarLoadingSvg from '@/renderer/assets/avatar_loading.svg';
import Tabs from '@/renderer/components/ui/Tabs';
import { useUserAvatar } from '../hooks/useUserAvatar';
import type { AvatarGenState, IGeneratedAvatarResult } from '../types';

const STYLE_CHIPS = [
  { key: 'healingIllustration', fallback: '治愈插画' },
  { key: 'inkPainting', fallback: '国风水墨' },
  { key: 'retroFilm', fallback: '复古胶片' },
  { key: 'cuteHandDrawn', fallback: '萌系手绘' },
  { key: 'blackWhiteLine', fallback: '黑白线稿' },
  { key: 'cartoonSticker', fallback: '卡通贴纸' },
];

const PRESETS: Array<{ value: 'boy' | 'girl'; src: string; nameKey: string; nameFallback: string; descKey: string; descFallback: string }> = [
  { value: 'boy', src: profileBoy, nameKey: 'boyName', nameFallback: '学院男生', descKey: 'boyDesc', descFallback: '清爽简约' },
  { value: 'girl', src: profileGirl, nameKey: 'girlName', nameFallback: '文化女生', descKey: 'girlDesc', descFallback: '温柔气质' },
];

// 「生成」按钮图标：1:1 还原原型 avatar-selector-prototype.html 的双星闪光 SVG
const SparkleIcon: React.FC = () => (
  <svg width='15' height='15' viewBox='0 0 48 48' fill='none'>
    <path d='M22 6L25.5 16.5L36 20L25.5 23.5L22 34L18.5 23.5L8 20L18.5 16.5L22 6Z' fill='currentColor' />
    <path d='M37 30L38.7 35.3L44 37L38.7 38.7L37 44L35.3 38.7L30 37L35.3 35.3L37 30Z' fill='currentColor' />
  </svg>
);

interface AvatarSelectorModalProps {
  visible: boolean;
  onClose: () => void;
}

const AvatarSelectorModal: React.FC<AvatarSelectorModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { setAvatar } = useUserAvatar();
  const inputRef = useRef<RefInputType>(null);

  const [prompt, setPrompt] = useState('');
  const [selectedStyleKey, setSelectedStyleKey] = useState('');
  const [genState, setGenState] = useState<AvatarGenState>('idle');
  const [result, setResult] = useState<IGeneratedAvatarResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 每次打开重置为初始态
  useEffect(() => {
    if (visible) {
      setPrompt('');
      setSelectedStyleKey('');
      setGenState('idle');
      setResult(null);
      setErrorMsg('');
    }
  }, [visible]);

  const handleStyleChange = (key: string) => {
    const item = STYLE_CHIPS.find((chip) => chip.key === key);
    if (!item) return;
    const label = t(`settings.avatarSelector.style.${item.key}`, item.fallback);
    setSelectedStyleKey(key);
    setPrompt(t('settings.avatarSelector.promptTemplate', { style: label, defaultValue: '一个{{style}}风格的头像' }));
    inputRef.current?.focus();
  };

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || genState === 'generating') return;
    setGenState('generating');
    setErrorMsg('');
    try {
      const res = await ipcBridge.tools.generateUserAvatar.invoke({ prompt: trimmed });
      if (!res.success || !res.data) {
        setErrorMsg(res.msg || t('settings.avatarSelector.generateFailed', '生成失败，请稍后再试'));
        setGenState('error');
        return;
      }
      setResult(res.data);
      setGenState('result');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setGenState('error');
    }
  };

  const handleUseGenerated = () => {
    if (!result) return;
    setAvatar({ type: 'generated', localPath: result.localPath });
    Message.success(t('settings.avatarSelector.avatarUpdated', '头像已更新'));
    onClose();
  };

  const handleUsePreset = (value: 'boy' | 'girl') => {
    setAvatar({ type: 'preset', value });
    Message.success(t('settings.avatarSelector.avatarUpdated', '头像已更新'));
    onClose();
  };

  const generateDisabled = !prompt.trim() || genState === 'generating';

  return (
    <Modal title={t('settings.avatarSelector.title', '选择头像')} visible={visible} onCancel={onClose} style={{ width: 540 }} footer={null}>
      <div>
        <div>
          <div className='mb-3 flex items-center gap-1.5 text-13px font-600 text-foreground'>
            {t('settings.avatarSelector.aiGenerateTitle', 'AI 生成头像')}
            <span className='text-11px font-400 text-secondary'>{t('settings.avatarSelector.aiGenerateHint', '选择风格或直接描述，由 AI 为你生成')}</span>
          </div>

          <Tabs value={selectedStyleKey} onChange={handleStyleChange} items={STYLE_CHIPS.map(({ key, fallback }) => ({ value: key, label: t(`settings.avatarSelector.style.${key}`, fallback) }))} />

          <div className='mt-3 flex gap-2'>
            <Input className='flex-1' ref={inputRef} value={prompt} onChange={setPrompt} placeholder={t('settings.avatarSelector.promptPlaceholder', '描述你想要的头像，例如：一个治愈插画风格的头像')} onPressEnter={handleGenerate} />
            <Button type='primary' icon={<SparkleIcon />} disabled={generateDisabled} onClick={handleGenerate}>
              {t('settings.avatarSelector.generate', '生成')}
            </Button>
          </div>

          {/* 结果区：四状态 */}
          <div className={`mt-4 min-h-33 f-center border border-dashed border-default bg-control rd-12px p-5 text-center ${genState === 'result' || genState === 'generating' ? 'flex-row gap-7' : 'flex-col gap-3'}`}>
            {genState === 'idle' && (
              <div className='text-12px text-secondary leading-[1.6]'>
                {t('settings.avatarSelector.idleLine1', '输入描述后点击「生成」')}
                <br />
                {t('settings.avatarSelector.idleLine2', 'AI 生成的头像将显示在这里')}
              </div>
            )}

            {genState === 'generating' && (
              <>
                <img className='h-8 w-8 animate-spin' src={avatarLoadingSvg} alt='' />
                <div className='text-13px text-secondary'>{t('settings.avatarSelector.generating', '正在生成头像…')}</div>
              </>
            )}

            {genState === 'result' && result && (
              <>
                <img className='h-16 w-16 rd-full object-cover shadow-[0_2px_8px_rgba(0,0,0,0.12)]' src={result.dataUrl} alt={t('settings.avatarSelector.generatedAvatarAlt', '生成的头像')} />
                <Button type='primary' icon={<IconCheck />} onClick={handleUseGenerated}>
                  {t('settings.avatarSelector.useThisAvatar', '使用此头像')}
                </Button>
              </>
            )}

            {genState === 'error' && (
              <>
                <div className='text-13px text-danger'>{errorMsg}</div>
                <div className='text-12px text-secondary'>{t('settings.avatarSelector.retryHint', '描述已保留，可调整后直接再次点击「生成」重试')}</div>
              </>
            )}
          </div>
        </div>

        {/* ========== 分隔 ========== */}
        <Divider
          className='mt-6 mb-5 text-12px text-secondary'
          style={{
            borderBottomStyle: 'dashed',
          }}
        >
          {t('settings.avatarSelector.presetDivider', '或选择预设头像')}
        </Divider>

        {/* ========== 预设头像 ========== */}
        <div>
          <div className='grid grid-cols-2 gap-3'>
            {PRESETS.map((preset) => {
              const presetName = t(`settings.avatarSelector.preset.${preset.nameKey}`, preset.nameFallback);
              return (
                <div key={preset.value} className='flex items-center gap-3 border border-transparent rd-12px bg-control p-3 cursor-pointer transition-[background,border-color,transform] duration-150 hover:bg-fill-2 hover:border-light active:scale-98' onClick={() => handleUsePreset(preset.value)}>
                  <img className='h-10 w-10 flex-shrink-0 rd-full object-cover' src={preset.src} alt={presetName} />
                  <div>
                    <div className='text-14px font-600 text-foreground'>{presetName}</div>
                    <div className='mt-0.5 text-11px text-secondary'>{t(`settings.avatarSelector.preset.${preset.descKey}`, preset.descFallback)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AvatarSelectorModal;
