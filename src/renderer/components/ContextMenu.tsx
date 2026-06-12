/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    // Adjust position if it goes off screen
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      if (x + rect.width > screenWidth) {
        newX = screenWidth - rect.width - 8;
      }
      if (y + rect.height > screenHeight) {
        newY = screenHeight - rect.height - 8;
      }

      setPosition({ x: newX, y: newY });
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [x, y, onClose]);

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className='fixed z-[9999] min-w-[180px] bg-popup border border-solid border-[var(--color-border-2)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.2)] py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-150 ease-out'
      style={{
        left: position.x,
        top: position.y,
        backdropFilter: 'blur(10px)',
      }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          className={`w-full flex items-center px-4 py-2.5 text-[14px] transition-all hover:bg-[var(--color-fill-3)] active:bg-[var(--color-fill-4)] disabled:opacity-40 disabled:cursor-not-allowed border-none bg-transparent ${item.danger ? 'text-danger' : 'text-[var(--color-text-1)]'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          disabled={item.disabled}
        >
          {item.icon && <span className='mr-3 flex items-center justify-center opacity-80'>{item.icon}</span>}
          <span className='flex-1 text-left font-medium leading-tight'>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
};

export default ContextMenu;
