# context/follow-ups-board.md
# Cross-terminal follow-ups ledger. Boundary = files an item may touch.
# Don't start an item whose boundary intersects another terminal's live branch
# (verify: git merge-tree). Claim before starting; update on ship.

| # | Item | Owner | Boundary | Status |
|---|------|-------|----------|--------|
| 3 | :id UUID validation across all controllers (admin + dispatch + reference + transport-orders); prod DELETE /admin/drivers/<non-uuid> was 500 | T2 | apps/api/src/{common,admin,dispatch,reference,transport-orders}, apps/api/test | SHIPPED (fix/admin-id-param-validation) |
| 5 | projection:rebuild Turbo task (reset watermark, re-derive dispatch_board from write model) | T2 | apps/api/src/projections, turbo.jsonc, apps/api/test | queued (next) |
| 7 | Browser-flow claim-parity e2e spec (real authz-code+PKCE vs local mock) | T2 | e2e | queued |
| 4 | Driver name-case normalization (citext vs lower() unique; merge/keep case-variant rows; align reactivate match) | T2 | reference schema, drizzle, admin, test | queued (design-first) |
| 6 | Secret rotation: GEMINI_API_KEY + Railway PG password; update every worktree .env; redeploy; verify old dead | T2 ops | .env (all worktrees), Railway, Google console | queued |
| 8 | Re-mint OPS_WEB_FLEET_API_TOKEN from current mock (acr=aal3); fold into 6 | T2 ops | .env | queued |
| 1 | admin-drivers-client reads problem+json body (render 409 detail, e.g. Tai xe "..." da ton tai) | T1 | apps/ops-web/src/features/admin, app/admin/drivers | with T1 (live arc) |
| 2 | False-failure alert on successful Xoa (post-success refresh/revalidateDispatch throws) | T1 | same as #1 | with T1 |
| 9 | Migrate off legacy fleet-pilot stack: merge develop, pnpm i, compose:env, own stack; final docker compose -p fleet-pilot down -v when all migrated | T1, T3 | per-terminal .env/stack | T2 done; T1/T3 pending |
