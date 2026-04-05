import { useState } from 'react';
import { useLoaderData, Form, useNavigation, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';

export async function loader() {
  const influencers = await prisma.influencer.findMany({ orderBy: { name: 'asc' } });
  return { influencers };
}

export async function action({ request }) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'create') {
    await prisma.influencer.create({
      data: {
        name: formData.get('name'),
        handle: formData.get('handle'),
        followers: parseInt(formData.get('followers') || '0'),
        country: formData.get('country'),
        email: formData.get('email') || null,
      },
    });
  }

  if (intent === 'delete') {
    await prisma.influencer.delete({ where: { id: parseInt(formData.get('id')) } });
  }

  return null;
}

const inputStyle = {
  padding: '9px 10px',
  border: '1px solid #ddd',
  fontSize: '13px',
  width: '100%',
  boxSizing: 'border-box',
};

export default function Influencers() {
  const { influencers } = useLoaderData();
  const navigation = useNavigation();
  const [showForm, setShowForm] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <h2 style={{ margin: 0 }}>Influencers</h2>
        <button onClick={() => setShowForm(v => !v)}
          style={{ padding: '8px 16px', backgroundColor: showForm ? '#fff' : '#000', color: showForm ? '#000' : '#fff', border: '1px solid #000', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
          {showForm ? 'Cancel' : '+ Add Influencer'}
        </button>
      </div>

      {showForm && (
        <Form method="post" onSubmit={() => { if (!isSubmitting) setShowForm(false); }}
          style={{ padding: '24px', backgroundColor: '#f5f5f5', marginBottom: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <input type="hidden" name="intent" value="create" />
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Full Name *
            <input name="name" required placeholder="Sofia García" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Handle *
            <input name="handle" required placeholder="@sofía_gs" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Followers
            <input name="followers" type="number" placeholder="45200" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Country *
            <input name="country" required placeholder="Spain" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', gridColumn: '1 / -1' }}>
            Email
            <input name="email" type="email" placeholder="sofia@example.com" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <button type="submit" disabled={isSubmitting}
            style={{ gridColumn: '1 / -1', padding: '11px', backgroundColor: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
            {isSubmitting ? 'Saving...' : 'Add Influencer'}
          </button>
        </Form>
      )}

      {influencers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#999', border: '2px dashed #ddd' }}>
          <p style={{ margin: '0 0 8px', fontSize: '16px' }}>No influencers yet.</p>
          <p style={{ margin: 0, fontSize: '13px' }}>Add your first one above to start creating seedings.</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #000' }}>
              {['Handle', 'Name', 'Followers', 'Country', 'Email', ''].map(h => (
                <th key={h} style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {influencers.map(inf => (
              <tr key={inf.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px 8px', fontWeight: '700' }}>{inf.handle}</td>
                <td style={{ padding: '12px 8px' }}>{inf.name}</td>
                <td style={{ padding: '12px 8px', color: '#666' }}>{inf.followers?.toLocaleString()}</td>
                <td style={{ padding: '12px 8px', color: '#666' }}>{inf.country}</td>
                <td style={{ padding: '12px 8px', color: '#999' }}>{inf.email || '—'}</td>
                <td style={{ padding: '12px 8px' }}>
                  <Form method="post" onSubmit={e => { if (!confirm(`Delete ${inf.handle}?`)) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={inf.id} />
                    <button type="submit" style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
