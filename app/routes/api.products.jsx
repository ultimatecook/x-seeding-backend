import { authenticate } from "../shopify.server";
import { handlePreflight } from "../utils/security.server";

export async function loader({ request }) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      #graphql
      query GetProducts {
        products(first: 50) {
          edges {
            node {
              id
              title
              variants(first: 1) {
                edges {
                  node {
                    price
                  }
                }
              }
            }
          }
        }
      }
    `);

    const { data } = await response.json();
    return { products: data.products.edges };
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
