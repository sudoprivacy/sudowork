import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Message } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Check, Close } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import AionModal from '@/renderer/components/base/AionModal';
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
    <AionModal
      visible={visible}
      onCancel={onClose}
      style={{ width: 540 }}
      footer={null}
      header={{
        render: () => (
          <div className='avatar-selector-header'>
            <span className='avatar-selector-title'>{t('settings.avatarSelector.title', '选择头像')}</span>
            <button className='avatar-selector-close' aria-label={t('common.close', '关闭')} onClick={onClose}>
              <Close size={20} fill='#86909c' />
            </button>
          </div>
        ),
      }}
    >
      <div className='mt-4'>
        {/* ========== AI 生成 ========== */}
        <div className='avatar-selector-section'>
          <div className='avatar-selector-section-label'>
            {t('settings.avatarSelector.aiGenerateTitle', 'AI 生成头像')}
            <span className='avatar-selector-hint'>{t('settings.avatarSelector.aiGenerateHint', '选择风格或直接描述，由 AI 为你生成')}</span>
          </div>

          <div className='avatar-selector-chips'>
            {STYLE_CHIPS.map(({ key, fallback }) => {
              const label = t(`settings.avatarSelector.style.${key}`, fallback);
              return (
                <button key={label} className={`avatar-selector-chip${selectedChip === label ? ' selected' : ''}`} onClick={() => handleChipClick(label)}>
                  {label}
                </button>
              );
            })}
          </div>

          <div className='avatar-selector-input-row'>
            <Input ref={inputRef} value={prompt} onChange={setPrompt} placeholder={t('settings.avatarSelector.promptPlaceholder', '描述你想要的头像，例如：一个治愈插画风格的头像')} onPressEnter={handleGenerate} />
            <Button type='primary' className='avatar-selector-primary-btn' icon={<SparkleIcon />} disabled={generateDisabled} onClick={handleGenerate}>
              {t('settings.avatarSelector.generate', '生成')}
            </Button>
          </div>

          {/* 结果区：四状态 */}
          <div className={`avatar-selector-result state-${genState}`}>
            {genState === 'idle' && (
              <div className='avatar-selector-idle-text'>
                {t('settings.avatarSelector.idleLine1', '输入描述后点击「生成」')}
                <br />
                {t('settings.avatarSelector.idleLine2', 'AI 生成的头像将显示在这里')}
              </div>
            )}

            {genState === 'generating' && (
              <>
                <img className='avatar-selector-loading-icon animate-spin' src={avatarLoadingSvg} alt='' />
                <div className='avatar-selector-loading-text'>{t('settings.avatarSelector.generating', '正在生成头像…')}</div>
              </>
            )}

            {genState === 'result' && result && (
              <>
                <img className='avatar-selector-preview' src={result.dataUrl} alt={t('settings.avatarSelector.generatedAvatarAlt', '生成的头像')} />
                <Button type='primary' className='avatar-selector-primary-btn' icon={<Check />} onClick={handleUseGenerated}>
                  {t('settings.avatarSelector.useThisAvatar', '使用此头像')}
                </Button>
              </>
            )}

            {genState === 'error' && (
              <>
                <div className='avatar-selector-error-text'>{errorMsg}</div>
                <div className='avatar-selector-error-sub'>{t('settings.avatarSelector.retryHint', '描述已保留，可调整后直接再次点击「生成」重试')}</div>
              </>
            )}
          </div>
        </div>

        {/* ========== 分隔 ========== */}
        <div className='avatar-selector-divider'>{t('settings.avatarSelector.presetDivider', '或选择预设头像')}</div>

        {/* ========== 预设头像 ========== */}
        <div className='avatar-selector-section'>
          <div className='avatar-selector-preset-grid'>
            {PRESETS.map((preset) => {
              const presetName = t(`settings.avatarSelector.preset.${preset.nameKey}`, preset.nameFallback);
              return (
                <div key={preset.value} className='avatar-selector-preset-card' onClick={() => handleUsePreset(preset.value)}>
                  <img className='avatar-selector-preset-avatar' src={preset.src} alt={presetName} />
                  <div>
                    <div className='avatar-selector-preset-name'>{presetName}</div>
                    <div className='avatar-selector-preset-desc'>{t(`settings.avatarSelector.preset.${preset.descKey}`, preset.descFallback)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AionModal>
  );
};

export default AvatarSelectorModal;
