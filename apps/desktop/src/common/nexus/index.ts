/**
 * @nexus/api-client — Shared HTTP client for Nexus APIs.
 *
 * @example
 * ```typescript
 * import { FetchClient, resolveConfig } from '@nexus/api-client';
 *
 * const config = resolveConfig({ apiKey: 'nx_live_myagent' });
 * const client = new FetchClient(config);
 * const files = await client.get('/api/v2/files/list?path=/');
 * ```
 *
 * @packageDocumentation
 */

// Client
export { FetchClient } from '@common/nexus/fetch-client';

// SSE
export { SseClient, RingBuffer } from '@common/nexus/sse-client';
export type { SseClientOptions, SseEventHandler, SseErrorHandler, SseReconnectHandler } from '@common/nexus/sse-client';

// Config
export { resolveConfig } from '@common/nexus/config';

// Errors
export { NexusApiError, AuthenticationError, ForbiddenError, NotFoundError, ConflictError, RateLimitError, ServerError, NetworkError, TimeoutError, AbortError } from '@common/nexus/errors';

// Types
export type { NexusClientOptions, RequestOptions, ApiErrorResponse, PaginatedResponse, SseEvent, AspectEnvelope, AspectListResponse, DatasetSchema, CatalogSchemaResponse, ColumnSearchResult, ColumnSearchResponse, ReplayRecord, ReplayResponse } from '@common/nexus/types';

// Case transform utilities
export { snakeToCamel, camelToSnake, transformKeys, snakeToCamelKeys, camelToSnakeKeys } from '@common/nexus/case-transform';

// Nexus VFS Client (gRPC via nexus-napi)
export { Nexus, NexusError, getNexusRpcClient } from './nexus-vfs-client.js';
export type { NexusRpcOptions, NexusListItem } from './nexus-vfs-client.js';
