/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Navigate } from 'react-router-dom';

/**
 * 系统运营管理入口（计划 3.5：admin-{organizations,users,assistant,policies,audit}
 * 五个独立页）。保留本路由仅为已收藏链接的兼容，默认跳转组织与绑定页。
 */

export default function ParkAdminPage() {
  return <Navigate to='/park/admin/organizations' replace />;
}
