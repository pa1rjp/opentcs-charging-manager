import { z } from 'zod'

export const ThresholdsSchema = z
  .object({
    critical: z.number().int().min(1).max(100),   // default: 30
    good: z.number().int().min(1).max(100),        // default: 50
    sufficient: z.number().int().min(1).max(100),  // default: 80
    full: z.number().int().min(1).max(100),        // default: 98
  })
  .refine(
    (t) => t.critical < t.good && t.good < t.sufficient && t.sufficient < t.full,
    {
      message:
        'Thresholds must be strictly ascending: critical < good < sufficient < full',
    }
  )

export const ChargerSchema = z.object({
  name: z.string().min(1),
  locationName: z.string().min(1),
  operation: z.string().default('CHARGE'),
})

export const VehicleConfigSchema = z.object({
  name: z.string().min(1),
  preferredCharger: z.string().optional(),
  preferredParkingPoint: z.string().optional(),
})

export const AppConfigSchema = z.object({
  thresholds: ThresholdsSchema,
  chargers: z.array(ChargerSchema).min(1),
  vehicles: z.array(VehicleConfigSchema).min(1),
  pollIntervalMs: z.number().int().min(1000).default(10000),
  engineEnabled: z.boolean().default(true),
})

export type Thresholds = z.infer<typeof ThresholdsSchema>
export type ChargerConfig = z.infer<typeof ChargerSchema>
export type VehicleConfig = z.infer<typeof VehicleConfigSchema>
export type AppConfig = z.infer<typeof AppConfigSchema>
