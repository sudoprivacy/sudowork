/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSudorouterBaseUrl } from '@sudowork/common/systemConfig';
import { pickDefaultImageModelFromPricing } from '@sudowork/common/imageGenerationModelConfig';
import type { SpecificImagePricingItem } from './scodeConfig';

/**
 * Fetch sudorouter specific_image_pricing items (the live image-model list + ratios).
 *
 * Deliberately dependency-free (only `fetch` / `getSudorouterBaseUrl` / `console.warn`):
 * no @process/* heavy deps, so it is usable from BOTH the main and renderer processes
 * and can be exercised against a local mock HTTP server in unit tests.
 *
 * Returns `null` on ANY failure (network/timeout/parse/success!==true) so callers can
 * distinguish "failed → keep old value" from "succeeded but empty". On success returns
 * the data array (possibly `[]`), with empty/whitespace `model_id` entries filtered out.
 */
export async function fetchSpecificImagePricingItems(): Promise<SpecificImagePricingItem[] | null> {
  let json: { success?: boolean; data?: SpecificImagePricingItem[] };
  try {
    const response = await fetch(`${getSudorouterBaseUrl()}/api/specific_image_pricing`, {
      signal: AbortSignal.timeout(15000),
    });
    json = (await response.json()) as typeof json;
  } catch (err) {
    console.warn('[imagePricingSource] specific_image_pricing fetch failed:', err instanceof Error ? err.message : String(err));
    return null;
  }

  if (json.success !== true || !Array.isArray(json.data)) {
    console.warn('[imagePricingSource] specific_image_pricing returned success!=true or no data');
    return null;
  }

  return json.data.filter((it) => typeof it?.model_id === 'string' && it.model_id.trim().length > 0);
}

/**
 * Resolve the rule-based default image model id from the pricing endpoint.
 *
 * Semantics of the return value (lets callers handle failure vs. empty distinctly):
 * - `null` → fetch failed (caller should keep the existing value, do NOT overwrite);
 * - `''`   → endpoint succeeded but returned an empty list (feature effectively off);
 * - other → the rule-selected model id (see pickDefaultImageModelFromPricing).
 */
export async function resolveDefaultImageModel(): Promise<string | null> {
  const items = await fetchSpecificImagePricingItems();
  if (items === null) return null;
  return pickDefaultImageModelFromPricing(items);
}
