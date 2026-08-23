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
  // artifacts.buildUrl is the INSTALLABLE artifact -- the apk/ipa a driver
  // downloads. Expo sends it only for a successful build, so both levels are
  // optional and its absence means "nothing to announce", never an error.
  //
  // It was previously parsed AWAY: the finished branch returned a silent 200,
  // so the one URL that matters -- the link the drivers need to install the
  // first OTA-capable binary -- never left the request handler.
  artifacts: z
    .looseObject({
      buildUrl: z.string().optional(),
    })
    .nullish(),
  // Identifies WHICH build, so the log line is self-describing and nobody has
  // to open the dashboard to interpret it.
  metadata: z
    .looseObject({
      appVersion: z.string().optional(),
      buildProfile: z.string().optional(),
    })
    .nullish(),
  buildDetailsPageUrl: z.string().optional(),
});
export type EasBuildWebhook = z.infer<typeof EasBuildWebhookSchema>;
