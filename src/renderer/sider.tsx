import { ArrowCircleLeft, Communication, Computer, Config, Lightning, ListCheckbox, Plus, SettingTwo, System, Toolkit } from '@icon-park/react';
import { IconMoonFill, IconSunFill } from '@arco-design/web-react/icon';
import classNames from 'classnames';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { iconColors } from './theme/colors';
import { Tooltip } from '@arco-design/web-react';
import { usePreviewContext } from './pages/conversation/preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from './utils/siderTooltip';
import { useLayoutContext } from './context/LayoutContext';
import { blurActiveElement } from './utils/focus';
import { useThemeContext } from './context/ThemeContext';
import { isElectronDesktop } from './utils/platform';

const WorkspaceGroupedHistory = React.lazy(() => import('./pages/conversation/WorkspaceGroupedHistory'));
const SettingsSider = React.lazy(() => import('./pages/settings/SettingsSider'));

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname, search, hash } = location;

  const { t } = useTranslation();
  const navigate = useNavigate();
  const { closePreview } = usePreviewContext();
  const { theme, setTheme } = useThemeContext();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
    } else {
      Promise.resolve(navigate('/settings/model')).catch((error) => {
        console.error('Navigation failed:', error);
      });
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleToggleBatchMode = () => {
    setIsBatchMode((prev) => !prev);
  };
  const handleQuickThemeToggle = () => {
    void setTheme(theme === 'dark' ? 'light' : 'dark');
  };
  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled: collapsed && !isMobile,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
    showTitle: false, // 我们已经在上面渲染了标题
  };
  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  const isDesktop = isElectronDesktop();

  // 功能菜单项定义 / Function menu items definition
  const functionMenus = [
    { id: 'skill', label: t('settings.skill'), icon: Lightning, path: '/settings/skill' },
    { id: 'tools', label: t('settings.tools'), icon: Toolkit, path: '/settings/tools' },
    { id: 'copilot', label: t('settings.copilot', { defaultValue: 'Copilot' }), icon: Config, path: '/settings/copilot' },
    { id: 'system', label: t('settings.system'), icon: System, path: '/settings/system' },
  ];

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled}></SettingsSider>
          </Suspense>
        ) : (
          <div className='size-full flex flex-col pl-0px pr-12px py-8px overflow-hidden'>
            {/* 新会话按钮 - 带边框的按钮风格 / New Chat button with border style */}
            <Tooltip {...siderTooltipProps} content={t('conversation.welcome.newConversation')} position='right'>
              {collapsed ? (
                <div
                  className='w-full h-40px flex items-center justify-center mb-12px rd-10px cursor-pointer transition-colors hover:bg-hover active:bg-fill-2'
                  onClick={() => {
                    cleanupSiderTooltips();
                    blurActiveElement();
                    closePreview();
                    setIsBatchMode(false);
                    Promise.resolve(navigate('/guid')).catch((error) => {
                      console.error('Navigation failed:', error);
                    });
                    if (onSessionClick) {
                      onSessionClick();
                    }
                  }}
                >
                  <div className='w-32px h-32px flex items-center justify-center rd-50% bg-[var(--color-fill-3)] text-t-secondary shrink-0'>
                    <Plus theme='outline' size='18' fill='currentColor' className='block leading-none' />
                  </div>
                </div>
              ) : (
                <div
                  className={classNames(
                    'h-40px flex items-center gap-10px px-16px mb-12px rd-10px cursor-pointer transition-all border border-solid',
                    'border-[var(--color-border-2)] bg-1 hover:bg-hover hover:border-[var(--color-border-3)] active:bg-fill-2'
                  )}
                  onClick={() => {
                    cleanupSiderTooltips();
                    blurActiveElement();
                    closePreview();
                    setIsBatchMode(false);
                    Promise.resolve(navigate('/guid')).catch((error) => {
                      console.error('Navigation failed:', error);
                    });
                    if (onSessionClick) {
                      onSessionClick();
                    }
                  }}
                >
                  <div className='w-32px h-32px flex items-center justify-center rd-50% bg-[var(--color-fill-3)] text-t-secondary shrink-0'>
                    <Plus theme='outline' size='18' fill='currentColor' className='block leading-none' />
                  </div>
                  <span className='flex-1 text-15px font-medium text-t-primary text-center truncate'>{t('conversation.welcome.newConversation')}</span>
                </div>
              )}
            </Tooltip>

            {/* 功能菜单区域 / Function menu area */}
            <div className='mb-16px flex flex-col gap-1px'>
              {functionMenus.map((menu) => (
                <Tooltip key={menu.id} {...siderTooltipProps} content={collapsed ? menu.label : undefined} position='right'>
                  <div
                    className={classNames(
                      'flex items-center gap-12px px-8px py-10px rd-8px cursor-pointer transition-colors hover:bg-hover active:bg-fill-2',
                      collapsed && 'justify-center px-0'
                    )}
                    onClick={() => {
                      cleanupSiderTooltips();
                      blurActiveElement();
                      Promise.resolve(navigate(menu.path)).catch((error) => {
                        console.error('Navigation failed:', error);
                      });
                      if (onSessionClick) {
                        onSessionClick();
                      }
                    }}
                  >
                    <div className='w-20px h-20px flex items-center justify-center text-t-secondary shrink-0'>
                      <menu.icon theme='outline' size='20' className='block leading-none' />
                    </div>
                    {!collapsed && (
                      <span className='flex-1 text-14px text-t-primary leading-24px whitespace-nowrap overflow-hidden text-ellipsis'>{menu.label}</span>
                    )}
                  </div>
                </Tooltip>
              ))}
            </div>

            {/* 所有对话标题 + 批量管理按钮 / All records title + Batch mode button */}
            <div className={classNames('mb-8px px-8px flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
              {!collapsed && (
                <span className='text-13px font-medium text-t-secondary'>{t('conversation.history.allRecords', { defaultValue: '所有对话' })}</span>
              )}
              <Tooltip {...siderTooltipProps} content={isBatchMode ? t('conversation.history.batchModeExit') : t('conversation.history.batchManage')} position='right'>
                <div
                  className={classNames(
                    'w-32px h-32px flex items-center justify-center rd-8px cursor-pointer transition-all shrink-0',
                    isBatchMode
                      ? 'bg-[rgba(var(--primary-6),0.12)] text-primary-6'
                      : 'hover:bg-hover active:bg-fill-2 text-t-secondary'
                  )}
                  onClick={handleToggleBatchMode}
                >
                  <ListCheckbox theme='outline' size='18' className='block leading-none' />
                </div>
              </Tooltip>
            </div>

            <Suspense fallback={<div className='flex-1 min-h-0' />}>
              <WorkspaceGroupedHistory {...workspaceHistoryProps}></WorkspaceGroupedHistory>
            </Suspense>
          </div>
        )}
      </div>
      {/* Footer - settings button */}
      <div className='shrink-0 sider-footer mt-auto pt-8px'>
        <div className='flex flex-col gap-8px'>
          {isSettings && (
            <Tooltip {...siderTooltipProps} content={theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode')} position='right'>
              <div onClick={handleQuickThemeToggle} className={classNames('flex items-center justify-start gap-10px px-12px py-8px rd-0.5rem cursor-pointer transition-colors hover:bg-hover active:bg-fill-2', isMobile && 'sider-footer-btn-mobile')} aria-label={theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode')}>
                {theme === 'dark' ? <IconSunFill style={{ fontSize: 18, color: 'rgb(var(--primary-6))' }} /> : <IconMoonFill style={{ fontSize: 18, color: 'rgb(var(--primary-6))' }} />}
                <span className='collapsed-hidden text-t-primary'>
                  {t('settings.theme')} · {theme === 'dark' ? t('settings.darkMode') : t('settings.lightMode')}
                </span>
              </div>
            </Tooltip>
          )}
          <Tooltip {...siderTooltipProps} content={isSettings ? t('common.back') : t('common.settings')} position='right'>
            <div
              onClick={handleSettingsClick}
              className={classNames('flex items-center justify-start gap-10px px-12px py-8px rd-0.5rem cursor-pointer transition-colors', isMobile && 'sider-footer-btn-mobile', {
                'bg-[rgba(var(--primary-6),0.12)] text-primary': isSettings,
                'hover:bg-hover hover:shadow-sm active:bg-fill-2': !isSettings,
              })}
            >
              {isSettings ? <ArrowCircleLeft className='flex' theme='outline' size='24' fill={iconColors.primary} /> : <SettingTwo className='flex' theme='outline' size='24' fill={iconColors.primary} />}
              <span className='collapsed-hidden text-t-primary'>{isSettings ? t('common.back') : t('common.settings')}</span>
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export default Sider;
