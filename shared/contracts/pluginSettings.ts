import { z } from "zod"

export const pluginSettingsSnapshotSchema = z.strictObject({
  values: z.record(z.string(), z.union([z.string().max(4096), z.number().finite(), z.boolean()])),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  adjustedFields: z.array(z.string().max(64)).max(32).optional(),
})
export type PluginSettingsSnapshot = z.infer<typeof pluginSettingsSnapshotSchema>
