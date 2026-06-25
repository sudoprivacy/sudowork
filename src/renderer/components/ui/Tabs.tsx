import classNames from 'classnames';
import React from 'react';

export default function Tabs({ items, value, onChange, className, itemClassName }: ITabsProps) {
  return (
    <div role='tablist' className={classNames('flex flex-wrap gap-2', className)}>
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type='button'
            role='tab'
            aria-selected={isActive}
            aria-disabled={item.isDisabled || undefined}
            disabled={item.isDisabled}
            title={item.title}
            className={classNames(
              'h-7 inline-flex items-center gap-1.5 border rd-full px-3 text-xs font-inherit transition-all',
              'active:scale-96 disabled:cursor-not-allowed disabled:opacity-55',
              isActive ? 'border-primary bg-primary font-semibold text-white hover:bg-primary hover:text-white hover:brightness-112' : 'bg-fill-2 text-foreground hover:bg-fill-3',
              item.isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
              itemClassName
            )}
            onClick={() => {
              if (!item.isDisabled) onChange(item.value);
            }}
          >
            {item.icon && <span className='inline-flex h-3.5 w-3.5 items-center justify-center'>{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ITabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  isDisabled?: boolean;
}

interface ITabsProps {
  items: ITabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  itemClassName?: string;
}
