// scripts/e2e/stack-stop.test.ts
// RED-first for the data-safe stack-stop planner. Contract: stop (never down)
// the fleet-pilot compose project so containers release their resident RAM
// while volumes + state survive for on-demand restart. The planner is pure so
// this test never spawns docker; main() runs only as the entrypoint (isEntry),
// exactly like stack-up.ts. stopComposeArgs must target the SAME composeProject
// stack-up uses (-p fleet-pilot) and must emit the state-preserving 'stop'
// subcommand -- never 'down' (which would destroy networks and risk volumes).
import { describe, expect, it } from 'vitest';
import {
  stackStopConfigSchema,
  defaultStopConfig,
  stopComposeArgs,
} from './stack-stop.js';

describe('stack-stop planner', () => {
  it('defaults to the same compose project as stack-up (fleet-pilot)', () => {
    expect(defaultStopConfig.composeProject).toBe('fleet-pilot');
  });

  it('schema rejects an empty compose project (fail-fast SSOT)', () => {
    expect(stackStopConfigSchema.safeParse({ composeProject: '' }).success).toBe(false);
  });

  it('plans compose stop for the project, scoped by -p', () => {
    const args = stopComposeArgs(defaultStopConfig);
    expect(args[0]).toBe('compose');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('fleet-pilot');
    expect(args).toContain('stop');
  });

  it('never issues a destructive down (state + volumes must survive)', () => {
    const args = stopComposeArgs(defaultStopConfig);
    expect(args).not.toContain('down');
    expect(args).not.toContain('-v');
    expect(args).not.toContain('--volumes');
  });

  it('honours an override project name', () => {
    const cfg = stackStopConfigSchema.parse({ composeProject: 'fleet-pilot-e2e' });
    expect(stopComposeArgs(cfg)).toContain('fleet-pilot-e2e');
  });
});
