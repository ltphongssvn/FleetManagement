// scripts/machine-doctor.test.ts
// RED (t123, 2026-08-16): a single op that answers "what can this machine
// actually do, and what is stopping it" -- with a remediation for every gap.
//
// WHY. Every defect in this session surfaced as a DISGUISED RUNTIME FAILURE,
// discovered mid-task by whoever tripped over it:
//   - no pre-commit hooks -> a commit made entirely of key material passed with
//     zero secret scanning, and nothing said so
//   - no container runtime -> the coverage gate printed a FAILED banner with an
//     empty log under it
//   - flock absent on macOS -> a missing binary wearing the costume of a red
//     test suite, blocking every push from every Mac
//   - not an age recipient -> env:decrypt refused, correctly, in the middle of
//     unrelated work
//   - git merge-drivers never registered -> STILL not surfaced anywhere
// The 2026 answer to this class is a doctor command: modular checks, a
// structured pass/fail report, and an actionable fix per finding, run BEFORE
// the work rather than discovered during it.
//
// CAPABILITIES, NOT FILES. Today proved a machine with no copied .env built 13
// workspaces, passed the 90/90/90/90 gate against Testcontainers, and shipped
// five PRs to production -- because compose.yaml hardcodes DATABASE_URL,
// REDIS_URL and the OIDC trio itself, and compose:env generates the only thing
// .env must carry. So "is there a .env" is the WRONG question and would report
// a false alarm on a perfectly working machine. The right question is which
// CAPABILITY is unavailable and why.
import { describe, it, expect } from 'vitest';
import {
  CAPABILITIES,
  capabilityStatus,
  diagnose,
  overallExit,
  remediationFor,
  type CheckInput,
} from './machine-doctor.js';

const ready: CheckInput = {
  binaries: ['git', 'gh', 'pnpm', 'node', 'pre-commit', 'detect-secrets', 'sops', 'age', 'docker'],
  hookTypes: ['commit-msg', 'pre-commit', 'pre-push'],
  containerRuntimeUp: true,
  ageIdentityPresent: true,
  isRecipient: true,
  ciphertextPresent: true,
  mergeDriverRegistered: true,
};

describe('capabilities are named, so a gap is legible before work starts', () => {
  it('covers the four that actually differ between machines', () => {
    for (const id of ['commit-safely', 'test-locally', 'decrypt-env', 'merge-generated-files']) {
      expect(CAPABILITIES.map((c) => c.id)).toContain(id);
    }
  });

  it('gives every capability a remediation, because a report without a fix is a complaint', () => {
    for (const capability of CAPABILITIES) {
      expect(remediationFor(capability.id).length).toBeGreaterThan(0);
    }
  });
});

describe('committing safely requires the guards to actually run', () => {
  it('is ready when every hook type and every scanner is present', () => {
    expect(capabilityStatus('commit-safely', ready)).toBe('ready');
  });

  it('is BROKEN when a hook type is missing, even if the others are installed', () => {
    expect(
      capabilityStatus('commit-safely', { ...ready, hookTypes: ['pre-commit'] }),
      'commit-msg and pre-push absent is exactly how a hand-fix looked finished',
    ).toBe('broken');
  });

  it('is BROKEN when detect-secrets is absent, because the hook cannot run', () => {
    expect(
      capabilityStatus('commit-safely', {
        ...ready,
        binaries: ready.binaries.filter((b) => b !== 'detect-secrets'),
      }),
    ).toBe('broken');
  });
});

describe('testing locally requires a container runtime, not a copied env file', () => {
  it('is ready with docker up, WITHOUT any secret material', () => {
    expect(
      capabilityStatus('test-locally', {
        ...ready,
        ageIdentityPresent: false,
        isRecipient: false,
        ciphertextPresent: false,
      }),
      'compose.yaml hardcodes DATABASE_URL/REDIS_URL/OIDC and Testcontainers brings its own Postgres',
    ).toBe('ready');
  });

  it('is BROKEN when the daemon is unreachable, the empty-log failure', () => {
    expect(capabilityStatus('test-locally', { ...ready, containerRuntimeUp: false })).toBe(
      'broken',
    );
  });
});

describe('decrypting is reported honestly, including the half nobody can fix alone', () => {
  it('is ready only with an identity, recipiency AND a committed ciphertext', () => {
    expect(capabilityStatus('decrypt-env', ready)).toBe('ready');
  });

  it('is BLOCKED, not broken, when the ciphertext was never committed', () => {
    expect(
      capabilityStatus('decrypt-env', { ...ready, ciphertextPresent: false }),
      'no local action fixes this: it needs one env:encrypt from a host holding the plaintext',
    ).toBe('blocked');
  });

  it('is BROKEN when this host simply has not generated an identity yet', () => {
    expect(capabilityStatus('decrypt-env', { ...ready, ageIdentityPresent: false })).toBe('broken');
  });

  it('is BROKEN when the identity exists but the host is not a recipient', () => {
    expect(capabilityStatus('decrypt-env', { ...ready, isRecipient: false })).toBe('broken');
  });
});

describe('the generated-file merge driver is config, and config rots silently', () => {
  it('is broken until registered, because a declared-but-unregistered driver does nothing', () => {
    expect(
      capabilityStatus('merge-generated-files', { ...ready, mergeDriverRegistered: false }),
    ).toBe('broken');
  });
});

describe('the verdict gates a script, not just a console', () => {
  it('is 0 when every capability is ready', () => {
    expect(overallExit(diagnose(ready))).toBe(0);
  });

  it('is non-zero when anything is BROKEN, because that is fixable here and now', () => {
    expect(overallExit(diagnose({ ...ready, containerRuntimeUp: false }))).not.toBe(0);
  });

  it('is 0 when the only gap is BLOCKED, which no local action can clear', () => {
    expect(
      overallExit(diagnose({ ...ready, ciphertextPresent: false })),
      'failing on someone else s pending action would train the operator to ignore the doctor',
    ).toBe(0);
  });

  it('reports every capability, so a gap can never be silently omitted', () => {
    expect(diagnose(ready)).toHaveLength(CAPABILITIES.length);
  });
});
