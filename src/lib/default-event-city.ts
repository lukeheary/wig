import { z } from "zod";

// The browsing metro selected during onboarding is independent of city/state
// on the public profile. This setting updates that existing choice.
export const defaultEventCityUpdateSchema = z
  .object({
    metroAreaId: z.string().uuid(),
  })
  .strict();
