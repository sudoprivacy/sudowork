import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Message, Modal } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Check } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import profileBoy from '@/renderer/assets/profile_boy.jpg';
import profileGirl from '@/renderer/assets/profile_girl.jpg';
import avatarLoadingSvg from '@/renderer/assets/avatar_loading.svg';
import { useUserAvatar } from '../hooks/useUserAvatar';
import type { AvatarGenState, IGeneratedAvatarResult } from '../types';
import './AvatarSelectorModal.css';

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
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [genState, setGenState] = useState<AvatarGenState>('idle');
  const [result, setResult] = useState<IGeneratedAvatarResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 每次打开重置为初始态
  useEffect(() => {
    if (visible) {
      setPrompt('');
      setSelectedChip(null);
      setGenState('idle');
      setResult(null);
      setErrorMsg('');
    }
  }, [visible]);

  const handleChipClick = (label: string) => {
    setSelectedChip(label);
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
        {/* ========== AI 生成 ========== */}
        <div>
          <div className='mb-12px flex items-center gap-6px text-13px font-600 text-foreground'>
            {t('settings.avatarSelector.aiGenerateTitle', 'AI 生成头像')}
            <span className='text-11px font-400 text-secondary'>{t('settings.avatarSelector.aiGenerateHint', '选择风格或直接描述，由 AI 为你生成')}</span>
          </div>

          <div className='flex flex-wrap gap-8px'>
            {STYLE_CHIPS.map(({ key, fallback }) => {
              const label = t(`settings.avatarSelector.style.${key}`, fallback);
              return (
                <button key={label} className={`avatar-selector-chip h-28px inline-flex items-center border-none rd-full bg-[var(--color-fill-2)] px-12px text-12px text-secondary font-inherit cursor-pointer${selectedChip === label ? ' selected' : ''}`} onClick={() => handleChipClick(label)}>
                  {label}
                </button>
              );
            })}
          </div>

          <div className='mt-12px flex gap-8px'>
            <Input className='flex-1' ref={inputRef} value={prompt} onChange={setPrompt} placeholder={t('settings.avatarSelector.promptPlaceholder', '描述你想要的头像，例如：一个治愈插画风格的头像')} onPressEnter={handleGenerate} />
            <Button type='primary' className='avatar-selector-primary-btn' icon={<SparkleIcon />} disabled={generateDisabled} onClick={handleGenerate}>
              {t('settings.avatarSelector.generate', '生成')}
            </Button>
          </div>

          {/* 结果区：四状态 */}
          <div className={`mt-16px min-h-132px flex items-center justify-center border border-dashed border-[var(--bg-3)] rd-12px bg-[var(--color-fill-1)] p-20px text-center ${genState === 'result' || genState === 'generating' ? 'flex-row gap-28px' : 'flex-col gap-12px'}`}>
            {genState === 'idle' && (
              <div className='text-12px text-secondary leading-[1.6]'>
                {t('settings.avatarSelector.idleLine1', '输入描述后点击「生成」')}
                <br />
                {t('settings.avatarSelector.idleLine2', 'AI 生成的头像将显示在这里')}
              </div>
            )}

            {genState === 'generating' && (
              <>
                <img className='h-32px w-32px animate-spin' src={avatarLoadingSvg} alt='' />
                <div className='text-13px text-secondary'>{t('settings.avatarSelector.generating', '正在生成头像…')}</div>
              </>
            )}

            {genState === 'result' && result && (
              <>
                <img className='h-64px w-64px rd-full object-cover shadow-[0_2px_8px_rgba(0,0,0,0.12)]' src={result.dataUrl} alt={t('settings.avatarSelector.generatedAvatarAlt', '生成的头像')} />
                <Button type='primary' className='avatar-selector-primary-btn' icon={<Check />} onClick={handleUseGenerated}>
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
        <div className='avatar-selector-divider mt-24px mb-20px flex items-center gap-12px text-12px text-secondary'>{t('settings.avatarSelector.presetDivider', '或选择预设头像')}</div>

        {/* ========== 预设头像 ========== */}
        <div>
          <div className='grid grid-cols-2 gap-12px'>
            {PRESETS.map((preset) => {
              const presetName = t(`settings.avatarSelector.preset.${preset.nameKey}`, preset.nameFallback);
              return (
                <div key={preset.value} className='avatar-selector-preset-card flex items-center gap-12px border border-transparent rd-12px bg-[var(--color-fill-1)] p-12px cursor-pointer' onClick={() => handleUsePreset(preset.value)}>
                  <img className='h-40px w-40px flex-shrink-0 rd-full object-cover' src={preset.src} alt={presetName} />
                  <div>
                    <div className='text-14px font-600 text-foreground'>{presetName}</div>
                    <div className='mt-2px text-11px text-secondary'>{t(`settings.avatarSelector.preset.${preset.descKey}`, preset.descFallback)}</div>
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
