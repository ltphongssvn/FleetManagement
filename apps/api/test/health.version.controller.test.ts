// apps/api/test/health.version.controller.test.ts
// L4 RED: GET /health/version returns build/version info sourced from the
// Railway-injected commit SHA env, with an unknown fallback off-platform.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HealthController } from "../src/health/health.controller.js";

const ORIG = process.env;
function makeCtl(): HealthController {
  return new HealthController({ query: () => Promise.resolve({}) } as never);
}

describe("@fleet/api - HealthController.version", () => {
  beforeEach(() => { process.env = { ...ORIG }; });
  afterEach(() => { process.env = ORIG; });

  it("returns sha/shortSha/branch/buildTime from RAILWAY_GIT_COMMIT_SHA env", () => {
    process.env["RAILWAY_GIT_COMMIT_SHA"] = "commit-sha-fixture-1234567";
    process.env["RAILWAY_GIT_BRANCH"] = "main";
    const v = makeCtl().version();
    expect(v.sha).toBe("commit-sha-fixture-1234567");
    expect(v.shortSha).toBe("commit-");
    expect(v.branch).toBe("main");
    expect(typeof v.buildTime).toBe("string");
  });

  it("falls back to unknown when no commit env is present", () => {
    delete process.env["RAILWAY_GIT_COMMIT_SHA"];
    delete process.env["GIT_SHA"];
    delete process.env["RAILWAY_GIT_BRANCH"];
    const v = makeCtl().version();
    expect(v.sha).toBe("unknown");
    expect(v.shortSha).toBe("unknown");
    expect(v.branch).toBe("unknown");
  });

  it("prefers GIT_SHA over RAILWAY_GIT_COMMIT_SHA when both set", () => {
    process.env["GIT_SHA"] = "1111111explicit";
    process.env["RAILWAY_GIT_COMMIT_SHA"] = "2222222railway";
    expect(makeCtl().version().sha).toBe("1111111explicit");
  });
});

// Blank-env handling. Dockerfile.api declares ARG RAILWAY_GIT_COMMIT_SHA and
// then ENV GIT_SHA=$ARG. Docker substitutes an unpassed ARG with the EMPTY
// STRING, so the image ships GIT_SHA set-but-blank. Nullish coalescing treats
// blank as PRESENT, so it wins over the value the platform injects at runtime
// and /health/version reported an empty sha in production forever.
describe("@fleet/api - HealthController.version blank env", () => {
  beforeEach(() => { process.env = { ...ORIG }; });
  afterEach(() => { process.env = ORIG; });

  it("treats an EMPTY GIT_SHA as absent, falling through to the platform var", () => {
    process.env["GIT_SHA"] = "";
    process.env["RAILWAY_GIT_COMMIT_SHA"] = "railwaysha9876543";
    const v = makeCtl().version();
    expect(v.sha).toBe("railwaysha9876543");
    expect(v.shortSha).toBe("railway");
  });

  it("treats a WHITESPACE-ONLY GIT_SHA as absent", () => {
    process.env["GIT_SHA"] = "   ";
    process.env["RAILWAY_GIT_COMMIT_SHA"] = "railwaysha9876543";
    expect(makeCtl().version().sha).toBe("railwaysha9876543");
  });

  it("reports unknown when BOTH sha vars are blank", () => {
    process.env["GIT_SHA"] = "";
    process.env["RAILWAY_GIT_COMMIT_SHA"] = "";
    const v = makeCtl().version();
    expect(v.sha).toBe("unknown");
    expect(v.shortSha).toBe("unknown");
  });

  it("treats an EMPTY GIT_BRANCH as absent, falling through to the platform var", () => {
    process.env["GIT_BRANCH"] = "";
    process.env["RAILWAY_GIT_BRANCH"] = "develop";
    expect(makeCtl().version().branch).toBe("develop");
  });

  it("reports unknown when BOTH branch vars are blank", () => {
    process.env["GIT_BRANCH"] = "";
    process.env["RAILWAY_GIT_BRANCH"] = "";
    expect(makeCtl().version().branch).toBe("unknown");
  });

  it("falls back to a real timestamp when BUILD_TIME is blank", () => {
    process.env["BUILD_TIME"] = "";
    expect(makeCtl().version().buildTime.length).toBeGreaterThan(0);
  });
});
