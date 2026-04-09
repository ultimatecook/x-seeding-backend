# Implementation Summary

## Scope

This project implements an embedded Shopify app focused on influencer seeding operations:

- Influencer management
- Campaign management
- Seeding creation and tracking
- Product sizing support per influencer

## Runtime architecture

- SSR app: React Router + Vite
- Persistence: Prisma + PostgreSQL
- Platform integration: Shopify App React Router SDK

## Current quality baseline

- Static checks: ESLint + TypeScript typecheck
- Tests: Vitest smoke suite in `tests/smoke/`
- CI: GitHub Actions workflow in `.github/workflows/ci.yml`

## Operational baseline

- Build: `npm run build`
- Start: `npm run start` (dynamic SSR entry resolution)
- Setup: `npm run setup`
