<!-- docs/ENV-BOOTSTRAP.md -->

# Environment bootstrap (SOPS + age)

How a machine gets a working `.env`. There is exactly one sanctioned path, and copying the file by
hand is not it.

## Why this exists

The repo has always been good at _blocking_ secrets and bad at _providing_ them. `.gitignore` bars
`.env`, the pre-commit `check-env-files` hook bars committing one, `detect-secrets` scans the index,
and `//#guard:local-secrets` scans the working tree. Four layers of prevention — and nothing that
could produce a `.env` on a new machine.

So the only available path was a human file copy over AirDrop, USB or chat. That is not a habit
anyone chose; it was the only thing that worked. It leaves plaintext credentials on every laptop,
gives rotation no defined procedure, and keeps no record of which host holds which vintage. Observed
2026-08-09 on a third machine whose fresh clone legitimately had no `.env` and could not obtain one
from the repository.

This closes the provisioning half. The encrypted file is **committed**; the plaintext never is.

## How it works

`sops` encrypts **values only**. Field names stay readable, so `.env.sops.yaml` diffs and reviews
like ordinary config — you can see that `DATABASE_URL` changed without seeing what it changed to.

`age` supplies the recipient scheme. Every machine holds its own private identity at
`~/.config/sops/age/keys.txt` (mode 600, never in the repo), and the file is encrypted to every
machine's **public** key. Adding or revoking a laptop is a re-encrypt against an edited recipient
list, not a re-copy.

| File                          | Tracked | Contents                                               |
| ----------------------------- | ------- | ------------------------------------------------------ |
| `.env`                        | no      | plaintext secrets, mode 600, produced by `env:decrypt` |
| `.env.sops.yaml`              | **yes** | ciphertext; values encrypted, field names legible      |
| `.age-recipients`             | yes     | one age **public** key per line; the human-edited SSOT |
| `.sops.yaml`                  | yes     | **generated** from the above; never hand-edit          |
| `~/.config/sops/age/keys.txt` | never   | this machine's **private** identity                    |

## New machine

Prerequisites: `brew install sops age` (macOS) or the distro equivalent.

1.  **Generate this machine's identity.**

        age-keygen -o ~/.config/sops/age/keys.txt
        chmod 600 ~/.config/sops/age/keys.txt

    The **public** key is printed on stderr as `Public key: age1...`. The private half stays in that
    file and never leaves the machine.

2.  **Get added as a recipient.** Send the public key to the repo owner. It goes into
    `.age-recipients` with a comment naming the host; the owner then runs `pnpm run env:recipients`
    and `pnpm run env:encrypt` and commits all three files. Until that lands, this machine cannot
    decrypt — by design.

3.  **Pull, then decrypt.**

        pnpm run env:decrypt

    Writes `.env` with mode 600. It **refuses** if a `.env` already exists rather than overwriting
    local edits that were never encrypted.

4.  **Inject the per-worktree Docker identity.**

        pnpm run compose:env

    `.env` carries a managed `fleet-compose-identity` block derived from the worktree's absolute
    path, so a block decrypted from another machine names the wrong project and ports. This
    regenerates it in place; the block is idempotent and leaves unrelated lines untouched.

## After changing a credential

       pnpm run env:encrypt

Then commit `.env.sops.yaml`. Every other machine picks it up on the next pull and re-runs
`env:decrypt`. This is the whole rotation procedure — one re-encrypt, one commit, instead of hunting
through three laptops for stale copies.

## Adding a machine

Append its public key to `.age-recipients`, then:

       pnpm run env:recipients   # regenerate .sops.yaml
       pnpm run env:encrypt      # re-encrypt to the new recipient set

Commit `.age-recipients`, `.sops.yaml` and `.env.sops.yaml` **together**. A recipient list that
disagrees with the ciphertext locks somebody out silently.

## Revoking a machine

Delete its line and repeat the two commands above — **then rotate the underlying credentials.**

Removing a recipient stops _future_ decryption. It does not retroactively protect ciphertext that
machine already held, and git history keeps every old blob. Revocation without rotation is theatre.

## Refusals

Every failure names a condition and a remedy, never a value. All are fail-closed and all are
deliberate:

| Message                                          | Meaning                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| `sops and age are required`                      | install the tooling                                |
| `No age identity found`                          | run step 1 above                                   |
| `The encrypted env file ... is not present`      | branch predates it; pull `develop`                 |
| `No .env to encrypt`                             | refusing to write empty ciphertext over a good one |
| `A .env already exists`                          | refusing to destroy unencrypted local edits        |
| `refusing to encrypt to an empty recipient list` | `.age-recipients` has no keys                      |

## Design notes

The private identity is passed to `sops` via `SOPS_AGE_KEY_FILE` in the environment, **never** as an
argv flag — argv is world-readable through the process table. Decrypted output goes straight to a
mode-600 file and is never echoed to stdout, so plaintext cannot reach terminal scrollback or a CI
log.

`.sops.yaml`'s `path_regex` targets the **plaintext input**, not the ciphertext output: sops
resolves a creation rule against the file it is reading. Decryption consults no creation rule at all
— the ciphertext carries its own recipients in its `sops` metadata block.

## Related

- `scripts/env-bootstrap.ts` — pure core (patterns, parsing, argv construction)
- `scripts/env-bootstrap-cli.ts` — imperative shell
- `SECURITY.md` — secret-blocking policy
- `//#guard:local-secrets` — catches a production credential sitting in a local env file
