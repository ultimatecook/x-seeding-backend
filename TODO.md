# Pending Tasks

## When Shopify API credits available

### 1. Delete draft order from Shopify when seeding is deleted (status still Pending)
- In `app/routes/app.seedings.jsx` action, `intent === 'delete'`:
  - Before deleting from DB, fetch the seeding to get `shopifyDraftOrderId` and `status`
  - If `status === 'Pending'` and `shopifyDraftOrderId` exists, call Shopify Admin API:
    ```graphql
    mutation draftOrderDelete($input: DraftOrderDeleteInput!) {
      draftOrderDelete(input: $input) { deletedId userErrors { field message } }
    }
    ```
    with `input: { id: shopifyDraftOrderId }`
  - Need `authenticate.admin(request)` in the action — currently the seedings action doesn't auth
  - Same logic needed for bulk delete in `app.seedings.jsx`
  - File: `app/routes/app.seedings.jsx`, action handler around line 79

### 2. Fix: deleting an influencer causes application error
- `app/routes/app.influencers._index.jsx` line 78: `prisma.influencer.delete()`
- Likely failing because influencer has related Seeding records (foreign key constraint)
- Fix: either cascade delete seedings, or block delete if seedings exist, or soft-delete (archive)
- Schema: `Influencer` → `Seeding` relation has no `onDelete` set, defaults to RESTRICT

### 3. Fix: "+ New Seeding" button in empty seedings state goes to login
- `app/routes/app.seedings.jsx` line 123: `<a href="/app/new">` — plain `<a>` tag loses Shopify auth context
- Fix: replace with React Router `<Link to="/app/new">` which stays within the app frame

### 4. Fix: duplicate "+ New Seeding" button visible (nav bar + page header)
- Remove the one on the page body — the nav bar button is sufficient
- File: `app/routes/app.seedings.jsx`, look for the second "+ New Seeding" button around line 100
