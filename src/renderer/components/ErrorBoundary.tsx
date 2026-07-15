import type { ErrorInfo, ReactNode } from 'react';
import React, { Component } from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';

function ErrorFallback({ errorMessage, onRetry }: { errorMessage?: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className='error-boundary-fallback'>
      <div className='error-boundary-fallback__title'>{t('common.errorBoundaryTitle', '出错了')}</div>
      <div className='error-boundary-fallback__message'>{errorMessage || t('common.errorBoundaryMessage', '发生了未知错误，请尝试重新加载')}</div>
      <div className='error-boundary-fallback__action'>
        <Button type='primary' onClick={onRetry}>
          {t('common.retry', '重试')}
        </Button>
      </div>
    </div>
  );
}

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

      return <ErrorFallback errorMessage={this.state.error?.message} onRetry={this.handleRetry} />;
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
