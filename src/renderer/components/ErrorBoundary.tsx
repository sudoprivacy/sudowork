/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className='error-boundary-fallback'>
          <div className='error-boundary-fallback__title'>出错了</div>
          <div className='error-boundary-fallback__message'>{this.state.error?.message || '发生了未知错误，请尝试重新加载'}</div>
          <div className='error-boundary-fallback__action'>
            <Button type='primary' onClick={this.handleRetry}>
              重试
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 函数组件版本的错误边界 Hook
 */
export const useErrorHandler = (onError?: (error: Error) => void) => {
  const { t } = useTranslation();

  const handleError = (error: unknown, context?: string): void => {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    console.error(`[ErrorHandler] ${context || 'Unknown context'}:`, errorObj);
    onError?.(errorObj);
  };

  const showErrorMessage = (message: string): void => {
    console.error('[ErrorMessage]', message);
  };

  return {
    handleError,
    showErrorMessage,
    t,
  };
};

export default ErrorBoundary;
