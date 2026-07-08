// apps/api/src/eas-inbound/eas-inbound.dto.ts
// Wire contract for the EAS BUILD webhook (Zod-first, trust boundary).
// looseObject: Expo's payload carries many fields and grows; unknown members
// survive so a newer Expo never breaks this receiver. status stays a loose
// string on the wire (forward-compat) -- the controller branches on the
// known terminal values only.
import { z } from 'zod';

export const EasBuildWebhookSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  platform: z.string().optional(),
  appId: z.string().optional(),
  error: z
    .looseObject({
      message: z.string().optional(),
      errorCode: z.string().optional(),
    })
    .nullish(),
});
export type EasBuildWebhook = z.infer<typeof EasBuildWebhookSchema>;
