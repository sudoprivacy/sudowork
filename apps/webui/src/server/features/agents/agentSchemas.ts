import { z } from 'zod'

/** 浏览器请求校验（计划 3.4：不接受 sourcePath/owner 作为授权事实）。 */

export const InstallRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
})

export const CreateAgentRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  avatar: z.string().max(500_000).optional(),
  prompt: z.string().max(100_000).optional(),
})

export const UpdateAgentMetaRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  updates: z
    .object({
      display_name: z.string().max(255).optional(),
      description: z.string().max(2000).optional(),
      avatar: z.string().max(500_000).optional(),
      emoji: z.string().max(16).optional(),
    })
    .strip(),
})

export const UninstallRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
})

export const UploadCustomRequestSchema = z.object({
  file: z.string().min(1).max(30_000_000), // base64 zip
})

export const HubListQuerySchema = z
  .object({
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    category: z.string().max(255).optional(),
    search: z.string().max(255).optional(),
  })
  .strip()

export const TenantCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  sourceAgentName: z.string().trim().min(1).max(255).optional(),
  visibleTo: z.record(z.string(), z.unknown()).optional(),
})

export const TenantPublishRequestSchema = z.object({
  sourceName: z.string().trim().min(1).max(255),
})
