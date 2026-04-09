# Troubleshooting

## `npm run start` fails with missing server entry

- Ensure a production build exists: `npm run build`.
- Confirm `build/server/` was generated.
- `scripts/start-server.mjs` resolves either:
  - `build/server/nodejs_*/index.js` (Vercel preset)
  - `build/server/index.js` (default fallback)

## Prisma connection issues

- Verify `DATABASE_URL` in `.env`.
- Run setup: `npm run setup`.
- Confirm the target database is reachable from the runtime environment.

## Shopify auth issues

- Check `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`.
- Use explicit config selection when needed:
  - `npm run config:use:local`
  - `npm run config:use:prod`

## CI failures

- Reproduce locally in order:
  1. `npm run lint`
  2. `npm run typecheck`
  3. `npm run test`
  4. `npm run build`
