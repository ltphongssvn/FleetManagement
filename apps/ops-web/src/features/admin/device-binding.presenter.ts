// apps/ops-web/src/features/admin/device-binding.presenter.ts
// Devices approval-queue status presenter: the SSOT contract code
// (@fleet/sync-protocol DeviceBindingStatus) -> immutable Vietnamese label + a
// semantic badge tone the table maps to colour. Two-tier discipline (same as
// co-so-du-lieu.presenter / driver-attention.presenter): input is a LOOSE string
// so an older UI never crashes on a newer producer code (generic fallback
// instead), while the strict Record over DeviceBindingStatus makes every
// CONTRACT code a compile-time obligation -- adding a binding status to
// @fleet/sync-protocol without a label here fails typecheck. Labels + tones are
// presentation; the codes are contract. Vietnamese UI strings are immutable
// contracts. The tone union is IMPORTED from the sibling presenter rather than
// redeclared, so the badge vocabulary stays a single definition.
import type { DeviceBindingStatus } from '@fleet/sync-protocol';
import type { DriverDbStatusTone } from '@/features/admin/co-so-du-lieu.presenter';

export interface DeviceBindingPresentation {
  readonly label: string;
  readonly tone: DriverDbStatusTone;
}

// Generic presentation for codes this build does not know.
export const DEVICE_BINDING_STATUS_FALLBACK: DeviceBindingPresentation =
  Object.freeze({ label: 'Không rõ', tone: 'neutral' });

// pending is the review queue an admin acts on; active is an approved device;
// revoked is terminal (recorded, never deleted -- the row is the audit trail).
const PRESENTATIONS: Record<DeviceBindingStatus, DeviceBindingPresentation> =
  Object.freeze({
    pending: Object.freeze({ label: 'Chờ duyệt', tone: 'warning' }),
    active: Object.freeze({ label: 'Đã duyệt', tone: 'success' }),
    revoked: Object.freeze({ label: 'Đã thu hồi', tone: 'neutral' }),
  });

function isKnownStatus(code: string): code is DeviceBindingStatus {
  return Object.prototype.hasOwnProperty.call(PRESENTATIONS, code);
}

// Loose in, immutable Vietnamese out; unknown -> generic fallback.
export function presentDeviceBindingStatus(
  code: string,
): DeviceBindingPresentation {
  return isKnownStatus(code) ? PRESENTATIONS[code] : DEVICE_BINDING_STATUS_FALLBACK;
}
