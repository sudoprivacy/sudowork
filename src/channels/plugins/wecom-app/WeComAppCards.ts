/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builders for WeCom 自建应用 `template_card` payloads.
 *
 * Docs: https://developer.work.weixin.qq.com/document/path/90236#%E6%A8%A1%E6%9D%BF%E5%8D%A1%E7%89%87%E6%B6%88%E6%81%AF
 *
 * We use two shapes:
 *   - text_notice: for status updates (no buttons)
 *   - button_interaction: for the initial approval card with a "View" button
 */

export interface ApprovalCardParams {
  /** The sp_no returned by oa/applyevent. */
  spNo: string;
  /** Short one-line summary of the approval. */
  summary: string;
  /** Optional template name, displayed as the main title. */
  templateName?: string;
  /** Optional creator display name. */
  creator?: string;
  /** Additional key/value rows displayed in horizontal_content_list. */
  details?: Array<{ keyname: string; value: string }>;
  /** Source text — defaults to "WeCom 审批". */
  sourceDesc?: string;
}

export interface ApprovalStatusCardParams {
  spNo: string;
  status: string; // human-readable status
  templateName?: string;
  summary?: string;
  /** Additional detail rows to surface. */
  details?: Array<{ keyname: string; value: string }>;
}

/**
 * Build a button_interaction card for a newly-created approval.
 */
export function buildApprovalCreatedCard(params: ApprovalCardParams): Record<string, unknown> {
  const horizontal: Array<Record<string, unknown>> = [];
  if (params.creator) horizontal.push({ keyname: '发起人', value: params.creator });
  horizontal.push({ keyname: '审批单号', value: params.spNo });
  if (params.details) {
    for (const row of params.details) {
      horizontal.push({ keyname: row.keyname, value: row.value });
    }
  }

  return {
    card_type: 'button_interaction',
    source: {
      desc: params.sourceDesc ?? 'WeCom 审批',
      desc_color: 1,
    },
    main_title: {
      title: params.templateName ?? '审批申请',
      desc: params.summary,
    },
    sub_title_text: params.summary,
    horizontal_content_list: horizontal,
    card_action: {
      type: 1,
      url: `https://open.work.weixin.qq.com/wwopen/approval/detail?sp_no=${encodeURIComponent(params.spNo)}`,
    },
    button_list: [
      {
        type: 0,
        text: '查看详情',
        key: `wecom-app.approval.view::${params.spNo}`,
      },
    ],
  };
}

/**
 * Build a text_notice card for an approval status update.
 */
export function buildApprovalStatusCard(params: ApprovalStatusCardParams): Record<string, unknown> {
  const horizontal: Array<Record<string, unknown>> = [{ keyname: '审批单号', value: params.spNo }];
  if (params.details) {
    for (const row of params.details) {
      horizontal.push({ keyname: row.keyname, value: row.value });
    }
  }
  return {
    card_type: 'text_notice',
    source: { desc: 'WeCom 审批', desc_color: 1 },
    main_title: {
      title: `审批状态：${params.status}`,
      desc: params.templateName ?? '审批通知',
    },
    sub_title_text: params.summary ?? '审批状态已更新',
    horizontal_content_list: horizontal,
    card_action: {
      type: 1,
      url: `https://open.work.weixin.qq.com/wwopen/approval/detail?sp_no=${encodeURIComponent(params.spNo)}`,
    },
  };
}

/**
 * Translate a WeCom SpStatus numeric code to a human-readable label.
 * Reference: sys_approval_change event documentation.
 */
export function translateApprovalStatus(spStatus: number | string | undefined): string {
  const code = typeof spStatus === 'string' ? Number(spStatus) : spStatus;
  switch (code) {
    case 1:
      return '审批中';
    case 2:
      return '已通过';
    case 3:
      return '已驳回';
    case 4:
      return '已转审';
    case 6:
      return '已撤销';
    case 7:
      return '通过后撤销';
    case 10:
      return '已删除';
    default:
      return `未知(${spStatus ?? 'unknown'})`;
  }
}
