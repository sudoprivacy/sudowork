/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';

/**
 * 表单字段错误状态
 */
export interface FormFieldError {
  /** 是否有错误 */
  hasError: boolean;
  /** 错误消息 */
  message?: string;
}

/**
 * 表单错误管理 Hook
 * @param initialErrors 初始错误状态
 * @param autoClearOnInput 是否在值变化时自动清除错误（默认 true）
 */
export const useFormErrors = <T extends Record<string, string>>(initialErrors: Partial<Record<keyof T, string>> = {}, autoClearOnInput = true) => {
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>(initialErrors);

  /**
   * 设置字段错误
   */
  const setFieldError = useCallback((field: keyof T, message: string | undefined): void => {
    setErrors((prev): Partial<Record<keyof T, string>> => {
      if (message === undefined || message === '') {
        const newErrors: Partial<Record<keyof T, string>> = { ...prev };
        delete newErrors[field];
        return newErrors;
      }
      return { ...prev, [field]: message };
    });
  }, []);

  /**
   * 清除字段错误
   */
  const clearFieldError = useCallback((field: keyof T): void => {
    setErrors((prev): Partial<Record<keyof T, string>> => {
      const newErrors: Partial<Record<keyof T, string>> = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  }, []);

  /**
   * 清除所有错误
   */
  const clearAllErrors = useCallback((): void => {
    setErrors({});
  }, []);

  /**
   * 检查字段是否有错误
   */
  const hasError = useCallback(
    (field: keyof T): boolean => {
      return field in errors;
    },
    [errors]
  );

  /**
   * 检查是否有任何错误
   */
  const hasAnyError = useCallback((): boolean => {
    return Object.keys(errors).length > 0;
  }, [errors]);

  /**
   * 验证表单
   */
  const validate = useCallback((values: T, rules: Partial<Record<keyof T, Array<(value: string, values: T) => string | undefined>>>): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {};

    (Object.keys(rules) as Array<keyof T>).forEach((field) => {
      const fieldRules = rules[field];
      const fieldValue = values[field];

      if (fieldRules) {
        for (const rule of fieldRules) {
          const errorMessage = rule(fieldValue as string, values);
          if (errorMessage) {
            newErrors[field] = errorMessage;
            break;
          }
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, []);

  /**
   * 获取字段错误状态
   */
  const getFieldError = useCallback(
    (field: keyof T): FormFieldError => {
      const message = errors[field];
      return {
        hasError: message !== undefined,
        message,
      };
    },
    [errors]
  );

  /**
   * 创建自动清除错误的 onChange 处理器
   * @param field 字段名
   * @param baseOnChange 原始的 onChange 处理器
   */
  const createOnChangeWithAutoClear = useCallback(
    (field: keyof T, baseOnChange?: (value: string) => void) => {
      if (!autoClearOnInput) {
        return baseOnChange;
      }
      return (value: string) => {
        // 当用户开始输入时，清除该字段的错误
        if (errors[field]) {
          clearFieldError(field);
        }
        baseOnChange?.(value);
      };
    },
    [autoClearOnInput, errors, clearFieldError]
  );

  return {
    errors,
    setFieldError,
    clearFieldError,
    clearAllErrors,
    hasError,
    hasAnyError,
    validate,
    getFieldError,
    createOnChangeWithAutoClear,
  };
};

/**
 * 常用的表单验证规则
 */
export const FormValidators = {
  /**
   * 必填验证
   */
  required:
    (message = '此项为必填项') =>
    (value: string): string | undefined => {
      if (!value || value.trim() === '') {
        return message;
      }
      return undefined;
    },

  /**
   * 邮箱格式验证
   */
  email:
    (message = '请输入有效的邮箱地址') =>
    (value: string): string | undefined => {
      if (!value) return undefined; // 空值由 required 处理
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return message;
      }
      return undefined;
    },

  /**
   * 手机号格式验证（中国大陆）
   */
  phone:
    (message = '请输入有效的手机号') =>
    (value: string): string | undefined => {
      if (!value) return undefined;
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(value)) {
        return message;
      }
      return undefined;
    },

  /**
   * 最小长度验证
   */
  minLength:
    (min: number, message: (min: number) => string = (min) => `至少需要 ${min} 个字符`) =>
    (value: string): string | undefined => {
      if (!value) return undefined;
      if (value.length < min) {
        return message(min);
      }
      return undefined;
    },

  /**
   * 最大长度验证
   */
  maxLength:
    (max: number, message: (max: number) => string = (max) => `最多 ${max} 个字符`) =>
    (value: string): string | undefined => {
      if (!value) return undefined;
      if (value.length > max) {
        return message(max);
      }
      return undefined;
    },

  /**
   * URL 格式验证
   */
  url:
    (message = '请输入有效的 URL 地址') =>
    (value: string): string | undefined => {
      if (!value) return undefined;
      try {
        new URL(value);
        return undefined;
      } catch {
        return message;
      }
    },

  /**
   * 自定义正则验证
   */
  pattern:
    (regex: RegExp, message = '格式不正确') =>
    (value: string): string | undefined => {
      if (!value) return undefined;
      if (!regex.test(value)) {
        return message;
      }
      return undefined;
    },
};
