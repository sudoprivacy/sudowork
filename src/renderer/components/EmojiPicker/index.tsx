import { Popover, Tabs } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Common emoji categories with popular emojis
const EMOJI_CATEGORIES = {
  recent: {
    icon: '🕐',
    label: 'Recent',
    emojis: [] as string[], // Will be populated from localStorage
  },
  smileys: {
    icon: '😀',
    label: 'Smileys',
    emojis: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😅',
      '😂',
      '🤣',
      '😊',
      '😇',
      '🙂',
      '🙃',
      '😉',
      '😌',
      '😍',
      '🥰',
      '😘',
      '😗',
      '😙',
      '😚',
      '😋',
      '😛',
      '😜',
      '🤪',
      '😝',
      '🤑',
      '🤗',
      '🤭',
      '🤫',
      '🤔',
      '🤐',
      '🤨',
      '😐',
      '😑',
      '😶',
      '😏',
      '😒',
      '🙄',
      '😬',
      '🤥',
      '😌',
      '😔',
      '😪',
      '🤤',
      '😴',
      '😷',
      '🤒',
      '🤕',
      '🤢',
      '🤮',
      '🥵',
      '🥶',
      '🥴',
      '😵',
      '🤯',
      '🤠',
      '🥳',
      '😎',
      '🤓',
      '🧐',
      '😕',
      '😟',
      '🙁',
      '☹️',
      '😮',
    ],
  },
  animals: {
    icon: '🐱',
    label: 'Animals',
    emojis: [
      '🐶',
      '🐱',
      '🐭',
      '🐹',
      '🐰',
      '🦊',
      '🐻',
      '🐼',
      '🐨',
      '🐯',
      '🦁',
      '🐮',
      '🐷',
      '🐸',
      '🐵',
      '🐔',
      '🐧',
      '🐦',
      '🐤',
      '🦆',
      '🦅',
      '🦉',
      '🦇',
      '🐺',
      '🐗',
      '🐴',
      '🦄',
      '🐝',
      '🐛',
      '🦋',
      '🐌',
      '🐞',
      '🐜',
      '🦟',
      '🦗',
      '🕷',
      '🦂',
      '🐢',
      '🐍',
      '🦎',
      '🦖',
      '🦕',
      '🐙',
      '🦑',
      '🦐',
      '🦞',
      '🦀',
      '🐡',
      '🐠',
      '🐟',
      '🐬',
      '🐳',
      '🐋',
      '🦈',
      '🐊',
      '🐅',
    ],
  },
  food: {
    icon: '🍎',
    label: 'Food',
    emojis: [
      '🍎',
      '🍐',
      '🍊',
      '🍋',
      '🍌',
      '🍉',
      '🍇',
      '🍓',
      '🫐',
      '🍈',
      '🍒',
      '🍑',
      '🥭',
      '🍍',
      '🥥',
      '🥝',
      '🍅',
      '🍆',
      '🥑',
      '🥦',
      '🥬',
      '🥒',
      '🌶',
      '🫑',
      '🌽',
      '🥕',
      '🧄',
      '🧅',
      '🥔',
      '🍠',
      '🥐',
      '🥯',
      '🍞',
      '🥖',
      '🥨',
      '🧀',
      '🥚',
      '🍳',
      '🧈',
      '🥞',
      '🧇',
      '🥓',
      '🥩',
      '🍗',
      '🍖',
      '🦴',
      '🌭',
      '🍔',
      '🍟',
      '🍕',
      '🫓',
      '🥪',
      '🥙',
      '🧆',
      '🌮',
      '🌯',
    ],
  },
  activities: {
    icon: '⚽',
    label: 'Activities',
    emojis: [
      '⚽',
      '🏀',
      '🏈',
      '⚾',
      '🥎',
      '🎾',
      '🏐',
      '🏉',
      '🥏',
      '🎱',
      '🪀',
      '🏓',
      '🏸',
      '🏒',
      '🏑',
      '🥍',
      '🏏',
      '🪃',
      '🥅',
      '⛳',
      '🪁',
      '🏹',
      '🎣',
      '🤿',
      '🥊',
      '🥋',
      '🎽',
      '🛹',
      '🛼',
      '🛷',
      '⛸',
      '🥌',
      '🎿',
      '⛷',
      '🏂',
      '🪂',
      '🏋️',
      '🤼',
      '🤸',
      '⛹️',
      '🤺',
      '🤾',
      '🏌️',
      '🏇',
      '🧘',
      '🏄',
      '🏊',
      '🤽',
      '🚣',
      '🧗',
      '🚵',
      '🚴',
      '🏆',
      '🥇',
      '🥈',
      '🥉',
    ],
  },
  objects: {
    icon: '💡',
    label: 'Objects',
    emojis: [
      '💡',
      '🔦',
      '🏮',
      '🪔',
      '📱',
      '💻',
      '🖥',
      '🖨',
      '⌨️',
      '🖱',
      '🖲',
      '💾',
      '💿',
      '📀',
      '📼',
      '📷',
      '📸',
      '📹',
      '🎥',
      '📽',
      '🎬',
      '📺',
      '📻',
      '🎙',
      '🎚',
      '🎛',
      '🧭',
      '⏱',
      '⏲',
      '⏰',
      '🕰',
      '⌛',
      '📡',
      '🔋',
      '🔌',
      '💎',
      '🔧',
      '🔨',
      '⚒',
      '🛠',
      '🔩',
      '⚙️',
      '🧱',
      '⛓',
      '🧲',
      '🔫',
      '💣',
      '🔪',
      '🗡',
      '⚔️',
      '🛡',
      '🚬',
      '⚰️',
      '🪦',
      '⚱️',
      '🏺',
    ],
  },
  symbols: {
    icon: '❤️',
    label: 'Symbols',
    emojis: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❣️',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💘',
      '💝',
      '💟',
      '☮️',
      '✝️',
      '☪️',
      '🕉',
      '☸️',
      '✡️',
      '🔯',
      '🕎',
      '☯️',
      '☦️',
      '🛐',
      '⛎',
      '♈',
      '♉',
      '♊',
      '♋',
      '♌',
      '♍',
      '♎',
      '♏',
      '♐',
      '♑',
      '♒',
      '♓',
      '🆔',
      '⚛️',
      '🉑',
      '☢️',
      '☣️',
      '📴',
      '📳',
      '🈶',
      '🈚',
      '🈸',
      '🈺',
      '🈷️',
      '✴️',
    ],
  },
  flags: {
    icon: '🏁',
    label: 'Flags',
    emojis: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇨🇳', '🇺🇸', '🇯🇵', '🇰🇷', '🇬🇧', '🇫🇷', '🇩🇪', '🇮🇹', '🇪🇸', '🇷🇺', '🇧🇷', '🇮🇳', '🇦🇺', '🇨🇦', '🇲🇽', '🇦🇷'],
  },
};

type CategoryKey = keyof typeof EMOJI_CATEGORIES;

const RECENT_EMOJIS_KEY = 'sudowork.emoji.recent';
const MAX_RECENT_EMOJIS = 24;

// Arco Design Popover position types
type PopoverPosition = 'top' | 'bottom' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br' | 'lt' | 'lb' | 'rt' | 'rb';

interface EmojiPickerProps {
  value?: string;
  onChange?: (emoji: string) => void;
  children?: React.ReactNode;
  placement?: PopoverPosition;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ value, onChange, children, placement = 'bl' }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('smileys');

  // Load recent emojis from localStorage when popover opens
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    try {
      const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
      setRecentEmojis(stored ? JSON.parse(stored) : []);
    } catch {
      setRecentEmojis([]);
    }
  }, [visible]);

  const saveRecentEmoji = useCallback((emoji: string) => {
    try {
      const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
      let recent: string[] = stored ? JSON.parse(stored) : [];
      // Remove if already exists, then add to front
      recent = recent.filter((e) => e !== emoji);
      recent.unshift(emoji);
      // Keep only MAX_RECENT_EMOJIS
      recent = recent.slice(0, MAX_RECENT_EMOJIS);
      localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recent));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleSelectEmoji = useCallback(
    (emoji: string) => {
      saveRecentEmoji(emoji);
      onChange?.(emoji);
      setVisible(false);
    },
    [onChange, saveRecentEmoji]
  );

  const categoryKeys = useMemo(() => {
    const keys = Object.keys(EMOJI_CATEGORIES) as CategoryKey[];
    if (recentEmojis.length === 0) {
      return keys.filter((key) => key !== 'recent');
    }
    return keys;
  }, [recentEmojis.length]);

  const getEmojis = (key: CategoryKey) => (key === 'recent' ? recentEmojis : EMOJI_CATEGORIES[key].emojis);

  const renderGrid = (emojis: string[]) =>
    emojis.length > 0 ? (
      <div className='grid grid-cols-8 gap-2px'>
        {emojis.map((emoji, index) => (
          <button key={`${emoji}-${index}`} className='w-32px h-32px f-center text-20px cursor-pointer border-none bg-transparent rounded-md hover:bg-fill-2 transition-colors' onClick={() => handleSelectEmoji(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    ) : (
      <div className='text-center text-secondary py-16px text-14px'>{t('settings.noRecentEmojis', { defaultValue: 'No recent emojis' })}</div>
    );

  const pickerContent = (
    <div className='w-280px'>
      <Tabs activeTab={activeCategory} onChange={(v) => setActiveCategory(v as typeof activeCategory)} className='-mx-1'>
        {categoryKeys.map((key) => (
          <Tabs.TabPane key={key} title={<span title={EMOJI_CATEGORIES[key].label}>{EMOJI_CATEGORIES[key].label}</span>}>
            <div className='max-h-200px overflow-y-auto'>{renderGrid(getEmojis(key))}</div>
          </Tabs.TabPane>
        ))}
      </Tabs>
    </div>
  );

  return (
    <Popover trigger='click' position={placement} popupVisible={visible} onVisibleChange={setVisible} content={pickerContent} unmountOnExit>
      {children || <div className='w-40px h-40px f-center text-24px bg-fill-2 rounded-lg cursor-pointer hover:bg-fill-3 transition-colors'>{value || '😀'}</div>}
    </Popover>
  );
};

export default EmojiPicker;
