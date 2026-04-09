# Changes Summary

## Structural hardening applied

- Added robust production start resolver in `scripts/start-server.mjs`.
- Updated npm scripts in `package.json` (`start`, `test`, `format`, `lint:fix`, `config:use:*`).
- Added `.env.example` and made it trackable in `.gitignore`.
- Added explicit Prettier config in `.prettierrc.json`.
- Added smoke tests in `tests/smoke/`.
- Added CI workflow in `.github/workflows/ci.yml`.
- Updated `README.md` and `IMPLEMENTATION_INDEX.md` with current source-of-truth information.

## Why these changes

These updates reduce deployment ambiguity, add baseline quality gates, and make onboarding reproducible.
