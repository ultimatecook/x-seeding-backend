# Size System Guide

## Goal

Ensure seedings are created with explicit sizes per product.

## Core behavior

- Product category is inferred using `app/utils/size-helpers.js`.
- Variant titles are parsed to extract probable sizes.
- Influencer saved sizes can be reused to prefill selections.
- Submission is blocked when any product is missing a size.

## Related files

- `app/utils/size-helpers.js`
- `app/routes/api.influencer-sizes.jsx`
- `app/routes/app.new.jsx`

## Validation checklist

- Saved sizes can be fetched for an influencer.
- Saved size is applied automatically when category matches.
- User can override the selected size.
- Create action rejects payloads with missing sizes.
