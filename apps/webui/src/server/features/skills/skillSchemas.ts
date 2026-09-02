import { z } from 'zod'

export const InstallRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
})

export const SetEnabledRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  enabled: z.boolean(),
})

export const UninstallRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
})

export const UploadCustomRequestSchema = z.object({
  file: z.string().min(1).max(30_000_000),
})

export const HubListQuerySchema = z
  .object({
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    category: z.string().max(255).optional(),
    search: z.string().max(255).optional(),
  })
  .strip()

export const TenantPublishRequestSchema = z.object({
  sourceName: z.string().trim().min(1).max(255),
})
