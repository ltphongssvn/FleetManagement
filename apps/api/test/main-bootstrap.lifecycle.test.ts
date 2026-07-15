// apps/api/test/main-bootstrap.lifecycle.test.ts
// Factor IX (Disposability): the API must signal Nest to run lifecycle
// hooks on SIGTERM/SIGINT. Every graceful-shutdown behavior in this app
// (DB pool close, outbox drain, CommandsGateway in-flight push await) is
// wired to onModuleDestroy, which Nest only invokes when shutdown hooks
// are enabled. configureApp() is a LEAF (imports only @nestjs/common +
// the two exception filters) so this asserts the wiring without booting
// AppModule / ConfigModule (unit-lane graph-isolation rule).
import { describe, it, expect, vi } from "vitest";
import { configureApp } from "../src/configure-app.js";
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

describe("@fleet/api - bootstrap lifecycle wiring (Factor IX)", () => {
  it("configureApp enables Nest shutdown hooks exactly once", () => {
    const app = makeAppDouble();
    configureApp(app as unknown as Parameters<typeof configureApp>[0]);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
  });

  it("configureApp registers global exception filters and CORS", () => {
    const app = makeAppDouble();
    configureApp(app as unknown as Parameters<typeof configureApp>[0]);
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
    expect(app.enableCors).toHaveBeenCalledTimes(1);
  });
});
