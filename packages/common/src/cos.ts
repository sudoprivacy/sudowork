/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tencent COS bucket base URLs.
 *
 * The namespace was reorganized into three role-based buckets:
 *   - runtime: boot/runtime binaries (nexus, nexus-vfs, git, libreoffice)
 *   - release: app installers + electron-updater feed
 *   - hub:     skill marketplace assets (icons, packaged skills)
 *
 * Adoption is additive: the new buckets are primary, the legacy buckets stay
 * live as a download fallback. Legacy bases are kept only for that fallback and
 * should be deleted once the old buckets are decommissioned.
 */

const COS_HOST_SUFFIX = 'cos.ap-beijing.myqcloud.com';

// ── New role-based buckets (primary) ─────────────────────────────────────────
export const COS_RUNTIME_BASE = `https://sudowork-runtime-1309794936.${COS_HOST_SUFFIX}`;
export const COS_RELEASE_BASE = `https://sudowork-release-1309794936.${COS_HOST_SUFFIX}`;
export const COS_HUB_BASE = `https://sudowork-hub-1309794936.${COS_HOST_SUFFIX}`;

// ── Legacy buckets (fallback only — remove after deprecation) ─────────────────
export const COS_LEGACY_NEXUS_BASE = `https://sudoclaw-1309794936.${COS_HOST_SUFFIX}`;
export const COS_LEGACY_NEXUS_VFS_BASE = `https://sudoclaw-download-1309794936.${COS_HOST_SUFFIX}`;
export const COS_LEGACY_HUB_BASE = `https://sudoworkhub-1309794936.${COS_HOST_SUFFIX}`;
export const COS_LEGACY_RELEASE_BASE = `https://sudowork-download-1309794936.${COS_HOST_SUFFIX}`;
