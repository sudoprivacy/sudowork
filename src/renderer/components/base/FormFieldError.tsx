/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { Close } from '@icon-park/react';

interface FormFieldErrorProps {
  /** 错误消息，为空时不显示 */
  message?: string;
  /** 额外的类名 */
  className?: string;
  /** 是否显示错误图标 */
  showIcon?: boolean;
}

/**
 * 表单字段内联错误显示组件
 *
 * @example
 * ```tsx
 * <Input status={hasError ? 'error' : undefined} />
 * {hasError && <FormFieldError message={errorMessage} />}
 * ```
 */
const FormFieldError: React.FC<FormFieldErrorProps> = ({ message, className, showIcon = true }) => {
  if (!message) {
    return null;
  }

  return (
    <div className={classNames('form-field-error', className)} role='alert' aria-live='polite'>
      {showIcon && <Close size={12} className='flex-shrink-0' />}
      <span className='form-field-error__text'>{message}</span>
    </div>
  );
};

export default FormFieldError;
