export type MossCatalogKind = 'agents' | 'skills';
export type MossCatalogSource = 'hub' | 'tenant';

export interface IMossCatalogItem {
  id: string;
  kind: MossCatalogKind;
  source: MossCatalogSource;
  /** Provider/source type shown on expert cards; it never changes availability semantics. */
  expertType?: string;
  replacesId?: string;
  name: string;
  displayName: string;
  description: string;
  icon?: string;
  emoji?: string;
  categories: string[];
  /** Internal revision used for preparation and cache invalidation. */
  version: string;
  /** Human-readable asset version; never the catalog update timestamp. */
  displayVersion?: string;
  status?: string;
  isAvailable: boolean;
  isLocalAllowed?: boolean;
  content?: string;
  scenarios?: string[];
  features?: Array<{ title: string; description: string }>;
}

export interface IMossCatalogPage {
  items: IMossCatalogItem[];
  nextCursor: string | null;
  categories: string[];
  isCached?: boolean;
}

export interface IMossCatalogResource {
  id: string;
  kind: MossCatalogKind;
  source: MossCatalogSource;
  name: string;
  version: string;
  digest: string;
  downloadRef: string;
  runtimeRef: string;
  dependencies: string[];
  isLocalAllowed: boolean;
}

export interface IMossCatalogInstallation extends IMossCatalogResource {
  path: string;
  runtimeName: string;
  preparationId: string;
  displayName: string;
  description: string;
  icon?: string;
  emoji?: string;
  isEnabled: boolean;
  preparationResources?: IMossCatalogResource[];
}
