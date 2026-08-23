// apps/api/test/manifest.manual-netweight-controller.test.ts
// Outside-in RED (gap 1, API edge): a controller endpoint must strict-parse the
// manual net-weight body against SetManualNetWeightSchema and dispatch to
// ManifestService.setManualNetWeight with the operator context. The controller
// method does not exist yet -> compile/runtime RED.
import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { ManualNetWeightController } from '../src/manifest/manifest.controller.js';
import type { ManifestService } from '../src/manifest/manifest.service.js';
import { createOperatorContext } from '@fleet/test-fixtures';
const OP = createOperatorContext();
const MID = '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d';
function makeController(): {
  controller: ManualNetWeightController;
  setManualNetWeight: ReturnType<typeof vi.fn>;
} {
  const setManualNetWeight = vi.fn().mockResolvedValue({ manifestId: MID, status: 'manual' });
  const svc = { setManualNetWeight } as unknown as ManifestService;
  return { controller: new ManualNetWeightController(svc), setManualNetWeight };
}
describe('@fleet/api - ManualNetWeightController', () => {
  it('parses a valid body and dispatches to setManualNetWeight', async () => {
    const { controller, setManualNetWeight } = makeController();
    const body = { manifestId: MID, extractedNetWeightKg: 42130 };
    const r = await controller.setManual(body, OP);
    expect(setManualNetWeight).toHaveBeenCalledWith(body, OP);
    expect(r).toMatchObject({ manifestId: MID, status: 'manual' });
  });
  it('rejects a non-positive weight without dispatching', async () => {
    const { controller, setManualNetWeight } = makeController();
    await expect(
      controller.setManual({ manifestId: MID, extractedNetWeightKg: 0 }, OP),
    ).rejects.toBeInstanceOf(ZodError);
    expect(setManualNetWeight).not.toHaveBeenCalled();
  });
  it('rejects unknown keys (strict)', async () => {
    const { controller, setManualNetWeight } = makeController();
    await expect(
      controller.setManual({ manifestId: MID, extractedNetWeightKg: 5, extra: 1 }, OP),
    ).rejects.toBeInstanceOf(ZodError);
    expect(setManualNetWeight).not.toHaveBeenCalled();
  });
  it('rejects a missing manifestId without dispatching', async () => {
    const { controller, setManualNetWeight } = makeController();
    await expect(controller.setManual({ extractedNetWeightKg: 5 }, OP)).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(setManualNetWeight).not.toHaveBeenCalled();
  });
});
