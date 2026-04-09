import { Form, useActionData, useLoaderData } from 'react-router';
import { login } from '../../shopify.server';
import { loginErrorMessage } from './error.server';

export const loader = async ({ request }) => {
  const result = await login(request);
  if (result instanceof Response) throw result;
  const errors = loginErrorMessage(result);

  const url = new URL(request.url);
  return { errors, shop: url.searchParams.get('shop') || '' };
};

export const action = async ({ request }) => {
  const result = await login(request);
  if (result instanceof Response) throw result;
  const errors = loginErrorMessage(result);

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const { errors } = actionData || loaderData;
  const initialShop = loaderData?.shop || '';

  return (
    <div style={{ maxWidth: 420, margin: '60px auto', padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Log in</h1>
      <Form method="post" target="_top" style={{ display: 'grid', gap: 10 }}>
        <label htmlFor="shop" style={{ fontSize: 13, fontWeight: 600 }}>
          Shop domain
        </label>
        <input
          id="shop"
          name="shop"
          type="text"
          autoComplete="on"
          placeholder="example.myshopify.com"
          defaultValue={initialShop}
          style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
        />
        {errors?.shop ? (
          <p style={{ color: '#dc2626', margin: 0, fontSize: 13 }}>{errors.shop}</p>
        ) : null}
        <button
          type="submit"
          style={{
            padding: '10px 14px',
            borderRadius: 6,
            border: '1px solid #d97757',
            background: '#d97757',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Log in
        </button>
      </Form>
    </div>
  );
}
