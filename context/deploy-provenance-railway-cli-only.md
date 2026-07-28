# Deploy provenance under Railway CLI-only mode: why /health/version reported
# unknown for weeks, and the root fix

Status: root-fixed. SSOT for how the deployed commit reaches production.

## Symptom

inspect:prod-deploy --live-url failed against a perfectly healthy api that
answered HTTP 200 with well-formed JSON:

    version endpoint returned no usable sha (got: )

## Three layers, each hiding the next

1. BLANK SHADOWS PRESENT. Dockerfile.api declared ARG RAILWAY_GIT_COMMIT_SHA
   and set ENV GIT_SHA from it. Docker substitutes an ARG that was never
   passed with the EMPTY STRING, so the image shipped GIT_SHA present-but-
   blank. The controller read it with nullish coalescing, which treats blank
   as PRESENT, so the baked empty value beat the runtime value. Fixed by
   treating blank as absent in the reader, not in one Dockerfile spelling.

2. THE ARG COULD NEVER BE POPULATED. Fixing layer 1 changed the answer from
   blank to unknown, which was honest but still wrong. Railway auto-injects
   RAILWAY_GIT_COMMIT_SHA only for deploys triggered from a CONNECTED repo.
   railway-deploy.yml requires all three services to run in CLI-ONLY mode
   (Settings > Source connected to nothing) so Railway does not double-deploy
   alongside the Actions pipeline. CLI-only mode and Railway git variables are
   mutually exclusive BY DESIGN. No amount of Dockerfile work can fix that.

3. VERIFICATION WAS A HUMAN RITUAL. inspect:prod-deploy is run by hand, so a
   permanently unverifiable deploy surfaced only when someone happened to look.

## The fix

The deploy workflow already knows the exact deployed commit: the gate job
resolves it and exposes gate.outputs.head_sha. It simply never handed that to
Railway. Now scripts/ci/deploy-stamp.ts stamps GIT_SHA, GIT_BRANCH and
BUILD_TIME as Railway SERVICE variables before each railway up, and the
post-deploy smoke job asserts /health/version back against the deployed sha.

--skip-deploys is not optional. Without it, setting a variable triggers its own
redeploy, which stamps again, which redeploys: an infinite loop.

The Dockerfile ARG/ENV block was deleted rather than repaired. It was dead code
that actively caused the bug, and it had been accidentally duplicated.

## Rules banked

- A platform variable that is only injected under a deployment mode you have
  deliberately disabled is not a variable you have. Verify the injection path,
  not just the variable name.
- Stamp provenance from the builder, which knows the commit with certainty, and
  assert it in a gate. 2026 practice (OCI image.revision, SLSA) is that the
  build stamps and CI verifies; a human running a check is not verification.
- unknown must be a hard failure in the verifier, never a tolerated value. It
  was precisely the state that concealed this for weeks.
- An empty string is not absent. Any env reader crossing a Docker ARG boundary
  must treat blank as missing, because Docker manufactures blanks silently.
