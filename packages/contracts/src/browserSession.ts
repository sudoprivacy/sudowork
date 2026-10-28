import { z } from "zod";

const EpochSchema = z.number().int().nonnegative();
const SurfaceSchema = z.enum(["page", "window"]);
const ExistingExtensionSchema = z.object({
  sessionId: z.string().min(1).max(220),
  profileId: z.string().min(1).max(200),
});

export const BrowserFileSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  name: z.string().min(1).max(240),
  bytes: z
    .number()
    .int()
    .nonnegative()
    .max(16 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["upload", "download"]),
});
export type BrowserFile = z.infer<typeof BrowserFileSchema>;

export const BrowserSessionStateSchema = z.object({
  browserSessionId: z.string().min(1),
  profileId: z.string().min(1),
  state: z.enum(["stopped", "ai", "pausing", "human", "observing", "error"]),
  controlEpoch: EpochSchema,
  targetEpoch: EpochSchema,
  isController: z.boolean(),
  isHumanControlHeld: z.boolean().optional(),
  isHeadless: z.boolean().nullable(),
  transport: z.enum(["cdp", "extension", "electron"]),
  capabilities: z.object({
    authorizedPageLaunch: z.boolean().optional(),
    nativeWindow: z.boolean().optional(),
    conversationControl: z.boolean().optional(),
    dragInput: z.boolean().optional(),
    liveDragInput: z.boolean().optional(),
    clipboardText: z.boolean().optional(),
    selectionRead: z.boolean().optional(),
    lifecycle: z.boolean().optional(),
    fileTransfer: z.boolean().optional(),
    existingExtension: z.boolean().optional(),
    pageView: z.boolean(),
    windowView: z.boolean(),
    windowStream: z.boolean().optional(),
    persistentProfile: z.boolean(),
  }),
  activeTargetId: z.string().nullable(),
  tabs: z.array(
    z.object({ id: z.string().min(1), title: z.string(), url: z.string() }),
  ),
  error: z.string().nullable(),
  personalExtension: ExistingExtensionSchema.extend({
    isHeadless: z.boolean().nullable(),
  })
    .nullable()
    .optional(),
  dialog: z
    .object({
      type: z.string(),
      message: z.string(),
      defaultPrompt: z.string().optional(),
    })
    .nullable()
    .optional(),
  fileChooser: z
    .object({
      id: z.string().regex(/^[a-f0-9]{32}$/),
      mode: z.enum(["selectSingle", "selectMultiple"]),
    })
    .nullable()
    .optional(),
  downloads: z.array(BrowserFileSchema).max(100).optional(),
});

export const BrowserInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("copy-selection") }),
  z.object({
    kind: z.literal("drag-stream"),
    phase: z.enum(["begin", "move", "end", "cancel"]),
    gestureId: z.string().regex(/^[a-zA-Z0-9_-]{16,64}$/),
    sequence: z.number().int().min(0).max(4096),
    viewerId: z.string().uuid(),
    x: z.number().finite().nonnegative().max(8192),
    y: z.number().finite().nonnegative().max(8192),
  }),
  z.object({
    kind: z.literal("drag"),
    points: z
      .array(
        z.object({
          x: z.number().finite().nonnegative(),
          y: z.number().finite().nonnegative(),
        }),
      )
      .min(2)
      .max(64),
  }),
  z.object({
    kind: z.literal("paste"),
    text: z
      .string()
      .min(1)
      .max(8192)
      .refine((value) =>
        Array.from(value).every(
          (character) =>
            character.charCodeAt(0) >= 32 || "\n\r\t".includes(character),
        ),
      ),
  }),
  z.object({
    kind: z.literal("click"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  }),
  z.object({
    kind: z.literal("wheel"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    dy: z.number().finite(),
  }),
  z.object({
    kind: z.literal("text"),
    text: z
      .string()
      .min(1)
      .max(512)
      .refine((value) =>
        Array.from(value).every((character) => character.charCodeAt(0) >= 32),
      ),
  }),
  z.object({
    kind: z.literal("key"),
    key: z.enum([
      "Tab",
      "Enter",
      "Backspace",
      "Delete",
      "Escape",
      "ArrowLeft",
      "ArrowUp",
      "ArrowRight",
      "ArrowDown",
      "Home",
      "End",
      "SelectAll",
    ]),
    shift: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("dialog"),
    accept: z.boolean(),
    text: z.string().max(512).optional(),
  }),
]);

const operation = { controlEpoch: EpochSchema, targetEpoch: EpochSchema };

export const BrowserSessionActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state") }),
  z.object({ kind: z.literal("inspect-existing-extension") }),
  ExistingExtensionSchema.extend({
    kind: z.literal("connect-existing-extension"),
  }),
  z.object({ kind: z.literal("disconnect-existing-extension"), ...operation }),
  z.object({
    kind: z.literal("upload-files"),
    chooserId: z.string().regex(/^[a-f0-9]{32}$/),
    fileIds: z
      .array(z.string().regex(/^[a-f0-9]{32}$/))
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
    ...operation,
  }),
  z.object({ kind: z.literal("stop"), ...operation }),
  z.object({
    kind: z.literal("restart"),
    isHeadless: z.boolean(),
    transport: z.enum(["cdp", "extension"]),
    acknowledgeStateLoss: z.literal(true),
    ...operation,
  }),
  z.object({
    kind: z.literal("start"),
    isHeadless: z.boolean(),
    transport: z.enum(["cdp", "extension"]),
  }),
  z.object({
    kind: z.literal("attach"),
    viewerId: z.string().uuid(),
    surface: SurfaceSchema.optional(),
  }),
  z.object({ kind: z.literal("detach"), viewerId: z.string().uuid() }),
  z.object({
    kind: z.literal("frame"),
    viewerId: z.string().uuid(),
    surface: SurfaceSchema.optional(),
    ...operation,
  }),
  z.object({
    kind: z.literal("window-stream"),
    viewerId: z.string().uuid(),
    ...operation,
  }),
  z.object({ kind: z.literal("take"), ...operation }),
  z.object({
    kind: z.literal("return"),
    note: z.string().max(2000).optional(),
    ...operation,
  }),
  z.object({
    kind: z.literal("input"),
    input: BrowserInputSchema,
    surface: SurfaceSchema.optional(),
    ...operation,
  }),
  z.object({
    kind: z.literal("navigate"),
    url: z
      .string()
      .url()
      .max(8192)
      .refine((value) => /^https?:\/\//i.test(value)),
    ...operation,
  }),
  z.object({ kind: z.literal("back"), ...operation }),
  z.object({ kind: z.literal("forward"), ...operation }),
  z.object({ kind: z.literal("reload"), ...operation }),
  z.object({ kind: z.literal("new-tab"), ...operation }),
  z.object({
    kind: z.literal("select-tab"),
    targetId: z.string().min(1).max(256),
    ...operation,
  }),
  z.object({
    kind: z.literal("close-tab"),
    targetId: z.string().min(1).max(256),
    ...operation,
  }),
]);

export const BrowserSessionReplySchema = z.object({
  session: BrowserSessionStateSchema,
  stream: z
    .object({
      protocol: z.literal("rfb"),
      isViewOnly: z.literal(true),
      password: z.string().min(1).max(128),
      socketPath: z.string().startsWith("/ws/browser/").max(2048).optional(),
    })
    .optional(),
  existingExtension: ExistingExtensionSchema.nullable().optional(),
  setupInstructions: z.string().max(16000).optional(),
  selection: z
    .object({ text: z.string().max(8192), isAvailable: z.boolean() })
    .optional(),
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
export function isCurrentBrowserFrame(
  session: BrowserSessionState,
  frame: NonNullable<BrowserSessionReply["frame"]>,
): boolean {
  return (
    session.controlEpoch === frame.controlEpoch &&
    session.targetEpoch === frame.targetEpoch
  );
}
