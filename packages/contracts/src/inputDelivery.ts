import { z } from 'zod'

export const INPUT_DELIVERY_METHOD = '_sudocode/session/input'
export const INPUT_DELIVERY_UPDATE = '_sudocode/session/input_update'

export const inputContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
  }),
])

export const inputDeliverySchema = z.enum(['steer', 'queue'])
export type InputDelivery = z.infer<typeof inputDeliverySchema>
export type InputContent = z.infer<typeof inputContentSchema>

/** Editor state is opaque to the agent; recall returns it without re-expanding prompts. */
export const inputDraftSchema = z.object({
  text: z.string(),
  files: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
})
export type InputDraft = z.infer<typeof inputDraftSchema>

export const inputStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  activeTurnId: z.number().int().positive().nullable(),
  running: z.boolean(),
  paused: z.boolean(),
  pending: z.array(
    z.object({
      id: z.number().int().positive(),
      clientId: z.string(),
      display: z.string(),
      source: z.enum(['human', 'peer', 'subagent', 'background']),
      delivery: inputDeliverySchema,
    }),
  ),
})
export type InputState = z.infer<typeof inputStateSchema>

export const inputActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit'),
    clientId: z.string().min(1),
    content: z.array(inputContentSchema).min(1),
    delivery: inputDeliverySchema,
    display: z.string().optional(),
    draft: inputDraftSchema.optional(),
  }),
  z.object({ action: z.literal('flush') }),
  z.object({ action: z.literal('flush_or_cancel') }),
  z.object({ action: z.literal('recall') }),
  z.object({ action: z.literal('snapshot') }),
])
export type InputAction = z.infer<typeof inputActionSchema>

export const inputReceiptSchema = z.object({
  id: z.number().int().positive().optional(),
  cancelled: z.boolean().optional(),
  state: inputStateSchema,
  recalled: z
    .array(
      z.object({
        clientId: z.string(),
        content: z.array(inputContentSchema),
        draft: inputDraftSchema.nullish(),
      }),
    )
    .optional(),
})
export type InputReceipt = z.infer<typeof inputReceiptSchema>

const inputUsageSchema = z.object({
  totalTokens: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cachedReadTokens: z.number().nonnegative(),
  cachedWriteTokens: z.number().nonnegative(),
  costUnits: z.number().nonnegative().nullable(),
  costCurrency: z.string().nullable(),
})

export const inputUpdateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('committed'),
    clientId: z.string(),
    display: z.string(),
    source: z.enum(['human', 'peer', 'subagent', 'background']),
  }),
  z.object({ kind: z.literal('state'), state: inputStateSchema }),
  z.object({
    kind: z.literal('turn_complete'),
    turnId: z.number().int().positive(),
    stopReason: z.enum(['end_turn', 'cancelled']),
    usage: inputUsageSchema,
    cumulativeUsage: inputUsageSchema,
  }),
  z.object({ kind: z.literal('error'), message: z.string() }),
])
export type InputUpdate = z.infer<typeof inputUpdateSchema>
export const inputNotificationSchema = z.object({
  sessionId: z.string(),
  update: inputUpdateSchema,
})
