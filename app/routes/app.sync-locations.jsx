/**
 * /app/sync-locations
 * Authenticates via Shopify admin session and syncs locations to DB.
 * After syncing, redirects to the portal admin page.
 */
import { redirect, useRouteError } from 'react-router';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { syncLocationsWithAdmin } from '../utils/inventory.server';

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  await syncLocationsWithAdmin(shop, admin);

  return redirect('/portal/admin');
}

export default function SyncLocations() {
  return <p>Syncing locations…</p>;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
