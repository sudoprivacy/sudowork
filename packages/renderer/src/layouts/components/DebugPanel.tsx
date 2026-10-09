/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vite/client" />
import { Button, Descriptions, Popover, Select } from '@arco-design/web-react';
import { IconMoon, IconSun } from '@arco-design/web-react/icon';
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ThemePreference } from '@renderer/hooks/useTheme';
import { useThemeContext } from '@renderer/context/ThemeContext';
import { REGISTERED_ROUTE_PATHS } from '@renderer/router';

type DebugThemeOption = Extract<ThemePreference, 'light' | 'dark'>;
type DebugPanelOffset = { x: number; y: number };

const DEBUG_PANEL_MARGIN = 16;
const DEBUG_PANEL_DRAG_THRESHOLD = 4;

function DebuggerInfo() {
  const location = useLocation();
  const params = useParams();

  const fullPath = location.pathname + location.search + location.hash;

  const rows: [string, string][] = [
    ['url', fullPath],
    ['params', Object.keys(params).length ? JSON.stringify(params, null, 2) : '—'],
  ];

  return (
    <div className='font-mono'>
      <Descriptions column={1} data={rows.map(([label, value]) => ({ label, value }))} size='small' layout='inline-horizontal' labelStyle={{ width: 64, minWidth: 64 }} />
    </div>
  );
}

function DebuggerThemeSwitch() {
  const { themePreference, setTheme } = useThemeContext();
  const { t } = useTranslation();

  const themeOptions: { value: DebugThemeOption; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('settings.lightMode'), icon: <IconSun style={{ fontSize: 14 }} /> },
    { value: 'dark', label: t('settings.darkMode'), icon: <IconMoon style={{ fontSize: 14 }} /> },
  ];

  return (
    <div className='mt-3 flex items-center justify-between gap-3 border-t border-tiny pt-3'>
      <div className='shrink-0 font-sans text-12px text-3'>{t('settings.theme')}</div>
      <div className='inline-flex items-center gap-1 rounded-full bg-fill-1 p-1'>
        {themeOptions.map((option) => {
          const isActive = themePreference === option.value;

          return (
            <Button
              key={option.value}
              size='mini'
              type={isActive ? 'primary' : 'text'}
              icon={option.icon}
              className='!h-7 !rounded-full'
              onClick={() => {
                if (!isActive) void setTheme(option.value);
              }}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function DebuggerRouteJump({ onAfterNavigate }: IDebuggerRouteJumpProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [route, setRoute] = useState(location.pathname + location.search + location.hash);

  const onJump = () => {
    const nextRoute = route.trim();
    if (!nextRoute) return;

    void navigate(nextRoute.startsWith('/') ? nextRoute : `/${nextRoute}`);
    onAfterNavigate();
  };

  return (
    <div className='mt-3 flex items-center gap-2 border-t border-tiny pt-3'>
      <div className='shrink-0 font-sans text-12px text-3'>路由</div>
      <Select size='small' value={route} onChange={setRoute} showSearch placeholder='选择路由' className='min-w-0 flex-1'>
        {REGISTERED_ROUTE_PATHS.map((path) => (
          <Select.Option key={path} value={path}>
            {path}
          </Select.Option>
        ))}
      </Select>
      <Button size='small' type='primary' onClick={onJump}>
        跳转
      </Button>
    </div>
  );
}

function DebugPanelTrigger({ offset, visible, onVisibleChange, content }: IDebugPanelTriggerProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: 'debug-panel-trigger' });
  const x = offset.x + (transform?.x ?? 0);
  const y = offset.y + (transform?.y ?? 0);

  return (
    <div
      ref={setNodeRef}
      className='fixed z-9999 cursor-grab touch-none active:cursor-grabbing'
      style={{
        right: DEBUG_PANEL_MARGIN,
        bottom: DEBUG_PANEL_MARGIN,
        transform: CSS.Translate.toString({ x, y, scaleX: 1, scaleY: 1 }),
      }}
      {...attributes}
      {...listeners}
    >
      <Popover trigger='click' position='tr' popupVisible={visible} onVisibleChange={onVisibleChange} className='!w-[420px] !max-w-[420px]' triggerProps={{ autoFitPosition: false }} content={content}>
        <Button size='small' type='primary'>
          调试
        </Button>
      </Popover>
    </div>
  );
}

function DebugPanel() {
  const [visible, setVisible] = useState(false);
  const [offset, setOffset] = useState<DebugPanelOffset>({ x: 0, y: 0 });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DEBUG_PANEL_DRAG_THRESHOLD } }));

  const handleDragEnd = (event: DragEndEvent) => {
    setOffset((current) => ({
      x: current.x + event.delta.x,
      y: current.y + event.delta.y,
    }));
  };

  if (!import.meta.env.DEV) return null;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <DebugPanelTrigger
        offset={offset}
        visible={visible}
        onVisibleChange={setVisible}
        content={
          <div>
            <div className='flex items-center justify-between mb-2'>
              <span className='font-sans font-600 text-14px text-1'>调试面板</span>
              <Button size='mini' type='text' onClick={() => setVisible(false)}>
                ✕
              </Button>
            </div>
            <DebuggerInfo />
            <DebuggerRouteJump onAfterNavigate={() => setVisible(false)} />
            <DebuggerThemeSwitch />
          </div>
        }
      />
    </DndContext>
  );
}

export default DebugPanel;

interface IDebugPanelTriggerProps {
  offset: DebugPanelOffset;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  content: React.ReactNode;
}

interface IDebuggerRouteJumpProps {
  onAfterNavigate: () => void;
}
