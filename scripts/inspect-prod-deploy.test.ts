// File: FleetManagement/scripts/inspect-prod-deploy.test.ts
import { describe, it, expect } from "vitest";
import { computeDeployVerdict } from "./inspect-prod-deploy.js";

describe("computeDeployVerdict", () => {
  it("EFFECTIVE + exit 0 when fix is in both base and live", () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: true, aheadCount: 0 });
    expect(v.verdict).toBe("EFFECTIVE");
    expect(v.exitCode).toBe(0);
  });

  it("REDEPLOY-NEEDED + exit 1 when fix is in base but not live", () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: false, aheadCount: 3 });
    expect(v.verdict).toBe("REDEPLOY-NEEDED");
    expect(v.exitCode).toBe(1);
  });

  it("NOT-PROMOTED + exit 1 when fix is not even in base", () => {
    const v = computeDeployVerdict({ fixInBase: false, fixInLive: false, aheadCount: 7 });
    expect(v.verdict).toBe("NOT-PROMOTED");
    expect(v.exitCode).toBe(1);
  });

  it("surfaces aheadCount in the rendered lines", () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: false, aheadCount: 3 });
    expect(v.lines.join(String.fromCharCode(10))).toContain("3");
  });

  it("always emits the RAILWAY MANUAL CHECK reminder", () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: true, aheadCount: 0 });
    expect(v.lines.join(String.fromCharCode(10))).toContain("RAILWAY MANUAL CHECK");
  });
});
