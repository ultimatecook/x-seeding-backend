import { Outlet, NavLink, useRouteError } from 'react-router';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { C } from '../theme';

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);

    const res = await admin.graphql(`
      #graphql
      query GetProducts {
        products(first: 100) {
          edges {
            node {
              id
              title
              totalInventory
              featuredImage { url }
              collections(first: 5) { edges { node { title } } }
              variants(first: 30) {
                edges {
                  node {
                    id title price availableForSale
                    inventoryItem { unitCost { amount } }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const body = await res.json();
    const products = (body?.data?.products?.edges ?? []).map(edge => ({
      id:          edge.node.id,
      name:        edge.node.title,
      image:       edge.node.featuredImage?.url ?? null,
      stock:       edge.node.totalInventory ?? 0,
      collections: edge.node.collections.edges.map(c => c.node.title),
      variants:    edge.node.variants.edges.map(v => ({
        id:        v.node.id,
        title:     v.node.title,
        price:     parseFloat(v.node.price || 0),
        cost:      parseFloat(v.node.inventoryItem?.unitCost?.amount || 0) || null,
        available: v.node.availableForSale,
      })),
      price:     parseFloat(edge.node.variants.edges[0]?.node?.price || 0),
      cost:      parseFloat(edge.node.variants.edges[0]?.node?.inventoryItem?.unitCost?.amount || 0) || null,
      variantId: edge.node.variants.edges[0]?.node?.id ?? null,
    }));

    return { products, shop: session.shop };
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error('Layout loader error:', err);
    return { products: [], shop: '' };
  }
}

const navLinkStyle = ({ isActive }) => ({
  padding: '7px 16px',
  backgroundColor: isActive ? C.accent : 'transparent',
  color: isActive ? '#fff' : C.textSub,
  textDecoration: 'none',
  border: `1px solid ${isActive ? C.accent : C.border}`,
  fontSize: '13px',
  fontWeight: '600',
  borderRadius: '6px',
  transition: 'all 0.15s',
});

export default function AppLayout() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '1140px', margin: '0 auto', padding: '24px 20px', backgroundColor: C.bg, minHeight: '100vh' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: '16px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', backgroundColor: C.accent, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>✦</div>
          <h1 style={{ margin: 0, fontSize: '15px', fontWeight: '800', letterSpacing: '-0.3px', color: C.text }}>X – Seeding Manager</h1>
        </div>
        <nav style={{ display: 'flex', gap: '6px' }}>
          <NavLink to="/app" end style={navLinkStyle}>Dashboard</NavLink>
          <NavLink to="/app/seedings" style={navLinkStyle}>Seedings</NavLink>
          <NavLink to="/app/influencers" style={navLinkStyle}>Influencers</NavLink>
          <NavLink to="/app/campaigns" style={navLinkStyle}>Campaigns</NavLink>
          <NavLink to="/app/new" style={({ isActive }) => ({
            ...navLinkStyle({ isActive }),
            backgroundColor: isActive ? C.accent : C.accent,
            color: '#fff',
            border: `1px solid ${C.accent}`,
          })}>+ New Seeding</NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}

export function shouldRevalidate() {
  return false;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
