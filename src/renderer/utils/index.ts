/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export const removeStack = (...args: Array<() => void>) => {
  return () => {
    const list = args.slice();
    while (list.length) {
      list.pop()!();
    }
  };
};

export { uuid } from '@/common/utils';

export function maskPhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  }
  return phone;
}
