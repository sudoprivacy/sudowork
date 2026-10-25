import type { IOntologyConnectorInput } from './index.js';

/** Host metadata only; the canonical model is never an RDF snapshot. */
export interface IOntologyStudioProject {
  workspaceId: string;
  name: string;
  authority: 'rdf' | 'sudograph';
  description?: string;
  objectCount?: number;
  source?: {
    revision: string;
    observedAt?: string;
    structureComplete: boolean;
    objects: number;
    tables: number;
    databaseViews: number;
    fields: number;
    delivery: 'live' | 'snapshot' | 'unavailable';
    rowsEmbedded: number;
  };
}

export interface IOntologyStudioProjectList {
  items: IOntologyStudioProject[];
  sourceRegistration: {
    available: boolean;
    providers: ['sqlite'];
    execution: 'desktop';
  };
}

export interface IOntologyConnectSourceInput {
  operationId: string;
  connector: IOntologyConnectorInput;
  language: 'en' | 'zh';
}
