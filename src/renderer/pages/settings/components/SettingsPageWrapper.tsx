import classNames from 'classnames';
import React from 'react';

interface SettingsPageWrapperProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

const SettingsPageWrapper: React.FC<SettingsPageWrapperProps> = ({ children, className, contentClassName }) => {
  return (
    <div className={classNames('settings-page-wrapper w-full min-h-full box-border overflow-y-auto px-3 md:px-10 py-8', className)}>
      <div className={classNames('settings-page-content mx-auto w-full md:max-w-240', contentClassName)}>{children}</div>
    </div>
  );
};

export default SettingsPageWrapper;
