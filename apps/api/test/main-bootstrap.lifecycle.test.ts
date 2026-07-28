// apps/api/test/main-bootstrap.lifecycle.test.ts
// Factor IX (Disposability): the API must signal Nest to run lifecycle
// hooks on SIGTERM/SIGINT. Every graceful-shutdown behavior in this app
// (DB pool close, outbox drain, CommandsGateway in-flight push await) is
// wired to onModuleDestroy, which Nest only invokes when shutdown hooks
// are enabled. configureApp() is a LEAF (imports only @nestjs/common +
// the two exception filters) so this asserts the wiring without booting
// AppModule / ConfigModule (unit-lane graph-isolation rule).
//
// Factor III (Config): configureApp takes the ALREADY-VALIDATED config as
// an argument. The CORS assertion below is what makes a regression to a
// raw process.env read inside the function fail loudly.
import { describe, it, expect, vi } from "vitest";
import { configureApp, type AppConfig } from "../src/configure-app.js";
import type { Mock } from "vitest";

interface AppDouble {
  enableShutdownHooks: Mock;
  useGlobalFilters: Mock;
  enableCors: Mock;
}

function makeAppDouble(): AppDouble {
  return {
    enableShutdownHooks: vi.fn(),
    useGlobalFilters: vi.fn(),
    enableCors: vi.fn(),
  };
}

const CONFIG: AppConfig = {
  CORS_ORIGINS: ["https://xe.vominhchau.com", "http://localhost:3001"],
};

function apply(app: AppDouble): void {
  configureApp(app as unknown as Parameters<typeof configureApp>[0], CONFIG);
}

describe("@fleet/api - bootstrap lifecycle wiring (Factor IX)", () => {
  it("configureApp enables Nest shutdown hooks exactly once", () => {
    const app = makeAppDouble();
    apply(app);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
  });

  it("configureApp registers global exception filters exactly once", () => {
    const app = makeAppDouble();
    apply(app);
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
  });

  it("configureApp applies CORS origins from the injected validated config", () => {
    const app = makeAppDouble();
    apply(app);
    expect(app.enableCors).toHaveBeenCalledTimes(1);
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: CONFIG.CORS_ORIGINS,
      credentials: true,
    });
  });
});
