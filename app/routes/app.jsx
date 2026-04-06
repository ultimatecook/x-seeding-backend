import { Outlet, NavLink, useRouteError } from 'react-router';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';

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
              featuredImage {
                url
              }
              collections(first: 5) {
                edges {
                  node {
                    title
                  }
                }
              }
              variants(first: 30) {
                edges {
                  node {
                    id
                    title
                    price
                    availableForSale
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
      id: edge.node.id,
      name: edge.node.title,
      image: edge.node.featuredImage?.url ?? null,
      stock: edge.node.totalInventory ?? 0,
      collections: edge.node.collections.edges.map(c => c.node.title),
      variants: edge.node.variants.edges.map(v => ({
        id: v.node.id,
        title: v.node.title,
        price: parseFloat(v.node.price || 0),
        available: v.node.availableForSale,
      })),
      // fallback for top products section that uses price directly
      price: parseFloat(edge.node.variants.edges[0]?.node?.price || 0),
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
  padding: '8px 16px',
  backgroundColor: isActive ? '#000' : 'transparent',
  color: isActive ? '#fff' : '#000',
  textDecoration: 'none',
  border: '1px solid #000',
  fontSize: '13px',
  fontWeight: '500',
});

export default function AppLayout() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '1100px', margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '16px', marginBottom: '32px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '900', letterSpacing: '-0.5px' }}>X – Seeding Manager</h1>
        <nav style={{ display: 'flex', gap: '6px' }}>
          <NavLink to="/app" end style={navLinkStyle}>Dashboard</NavLink>
          <NavLink to="/app/influencers" style={navLinkStyle}>Influencers</NavLink>
          <NavLink to="/app/new" style={navLinkStyle}>+ New Seeding</NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}

// Only run the layout loader once (on initial Shopify load).
// Client-side navigation must NOT re-trigger authenticate.admin — it has no session token.
export function shouldRevalidate() {
  return false;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
