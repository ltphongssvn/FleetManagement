# Deployment

## apps/api (Fly.io)

```sh
cd apps/api
fly launch --no-deploy
fly secrets set DATABASE_URL=... REDIS_URL=... OIDC_ISSUER=... OIDC_AUDIENCE=... OIDC_JWKS_URI=...
fly deploy
```

## workers/main-worker (Fly.io)

```sh
cd workers/main-worker
fly launch --no-deploy
fly secrets set DATABASE_URL=... REDIS_URL=...
fly deploy
```

## apps/ops-web (Vercel)

```sh
cd apps/ops-web
vercel link
vercel env add FLEET_API_URL production
vercel env add FLEET_API_TOKEN production
vercel deploy --prod
```

## Migrations

```sh
cd apps/api
pnpm exec drizzle-kit push
```
