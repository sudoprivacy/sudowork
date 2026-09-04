/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

export function formatCurrency(amount: number, currency: 'USD' | 'CNY') {
  if (currency === 'CNY') {
    return `¥${amount}`;
  }
  return `$${amount}`;
}

export function formatDateTime(dateStr: string) {
  let date: Date;
  if (dateStr.includes('T')) {
    date = new Date(dateStr);
  } else {
    date = new Date(dateStr + 'Z');
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

export function formatAmount(amount: number) {
  return `¥${amount.toFixed(2)}`;
}
