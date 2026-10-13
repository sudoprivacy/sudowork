import { z } from 'zod';

const EpochSchema = z.number().int().nonnegative();
const SurfaceSchema = z.enum(['page', 'window']);

export const BrowserSessionStateSchema = z.object({
  browserSessionId: z.string().min(1),
  profileId: z.string().min(1),
  state: z.enum(['stopped', 'ai', 'pausing', 'human', 'observing', 'error']),
  controlEpoch: EpochSchema,
  targetEpoch: EpochSchema,
  isController: z.boolean(),
  isHeadless: z.boolean(),
  transport: z.enum(['cdp', 'extension', 'electron']),
  capabilities: z.object({
    pageView: z.boolean(),
    windowView: z.boolean(),
    persistentProfile: z.boolean(),
  }),
  activeTargetId: z.string().nullable(),
  tabs: z.array(z.object({ id: z.string().min(1), title: z.string(), url: z.string() })),
  error: z.string().nullable(),
  dialog: z.object({ type: z.string(), message: z.string(), defaultPrompt: z.string().optional() }).nullable().optional(),
});

export const BrowserInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  }),
  z.object({
    kind: z.literal('wheel'),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    dy: z.number().finite(),
  }),
  z.object({
    kind: z.literal('text'),
    text: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => Array.from(value).every((character) => character.charCodeAt(0) >= 32)),
  }),
  z.object({
    kind: z.literal('key'),
    key: z.enum(['Tab', 'Enter', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End', 'SelectAll']),
    shift: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('dialog'),
    accept: z.boolean(),
    text: z.string().max(512).optional(),
  }),
]);

const operation = { controlEpoch: EpochSchema, targetEpoch: EpochSchema };

export const BrowserSessionActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('state') }),
  z.object({
    kind: z.literal('start'),
    isHeadless: z.boolean(),
    transport: z.enum(['cdp', 'extension']),
  }),
  z.object({
    kind: z.literal('attach'),
    viewerId: z.string().uuid(),
    surface: SurfaceSchema.optional(),
  }),
  z.object({ kind: z.literal('detach'), viewerId: z.string().uuid() }),
  z.object({
    kind: z.literal('frame'),
    viewerId: z.string().uuid(),
    surface: SurfaceSchema.optional(),
    ...operation,
  }),
  z.object({ kind: z.literal('take'), ...operation }),
  z.object({
    kind: z.literal('return'),
    note: z.string().max(2000).optional(),
    ...operation,
  }),
  z.object({
    kind: z.literal('input'),
    input: BrowserInputSchema,
    surface: SurfaceSchema.optional(),
    ...operation,
  }),
  z.object({
    kind: z.literal('navigate'),
    url: z
      .string()
      .url()
      .max(8192)
      .refine((value) => /^https?:\/\//i.test(value)),
    ...operation,
  }),
  z.object({ kind: z.literal('back'), ...operation }),
  z.object({ kind: z.literal('forward'), ...operation }),
  z.object({ kind: z.literal('reload'), ...operation }),
  z.object({ kind: z.literal('new-tab'), ...operation }),
  z.object({
    kind: z.literal('select-tab'),
    targetId: z.string().min(1).max(256),
    ...operation,
  }),
  z.object({
    kind: z.literal('close-tab'),
    targetId: z.string().min(1).max(256),
    ...operation,
  }),
]);

export const BrowserSessionReplySchema = z.object({
  session: BrowserSessionStateSchema,
  frame: z
    .object({
      data: z.string().max(16 * 1024 * 1024),
      width: z.number().int().positive().max(8192),
      height: z.number().int().positive().max(8192),
      controlEpoch: EpochSchema,
      targetEpoch: EpochSchema,
      surface: SurfaceSchema.optional(),
    })
    .optional(),
});

export type BrowserSessionState = z.infer<typeof BrowserSessionStateSchema>;
export type BrowserSessionAction = z.infer<typeof BrowserSessionActionSchema>;
export type BrowserSessionReply = z.infer<typeof BrowserSessionReplySchema>;
export type BrowserInput = z.infer<typeof BrowserInputSchema>;

/** A frame captured before a handoff or tab switch must never replace current pixels. */
export function isCurrentBrowserFrame(session: BrowserSessionState, frame: NonNullable<BrowserSessionReply['frame']>): boolean {
  return session.controlEpoch === frame.controlEpoch && session.targetEpoch === frame.targetEpoch;
}
