import { useState } from 'react';
import { useLoaderData, useNavigate, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card } from '../theme';

const SIZE_OPTIONS = {
  tops: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'],
  bottoms: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'],
  shoes: ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', 'One Size'],
  dresses: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'],
};

const CATEGORIES = [
  { key: 'tops', label: '👕 Tops' },
  { key: 'bottoms', label: '👖 Bottoms' },
  { key: 'shoes', label: '👞 Shoes' },
  { key: 'dresses', label: '👗 Dresses' },
];

export async function loader({ params }) {
  const id = parseInt(params.id);
  const influencer = await prisma.influencer.findUnique({
    where: { id },
    include: { savedSizes: true },
  });
  if (!influencer) throw new Response('Influencer not found', { status: 404 });
  const sizeMap = {};
  influencer.savedSizes.forEach(ss => {
    sizeMap[ss.category] = ss.size;
  });
  return { influencer, sizeMap };
}

export async function action({ request, params }) {
  const influencerId = parseInt(params.id);
  if (request.method === 'POST') {
    const formData = await request.formData();
    const category = formData.get('category');
    const size = formData.get('size');
    if (!category || !size) {
      return new Response(JSON.stringify({ error: 'Missing data' }), { status: 400 });
    }
    try {
      await prisma.influencerSavedSize.upsert({
        where: { influencerId_category: { influencerId, category } },
        update: { size },
        create: { influencerId, category, size },
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }
  if (request.method === 'DELETE') {
    const formData = await request.formData();
    const category = formData.get('category');
    if (!category) {
      return new Response(JSON.stringify({ error: 'Missing category' }), { status: 400 });
    }
    try {
      await prisma.influencerSavedSize.deleteMany({
        where: { influencerId, category },
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

export default function InfluencerSizes() {
  const { influencer, sizeMap } = useLoaderData();
  const navigate = useNavigate();
  const [editCategory, setEditCategory] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSaveSize = async (category, size) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('size', size);
      const response = await fetch(`/app/influencers/${influencer.id}/sizes`, {
        method: 'POST',
        body: formData,
      });
      if (response.ok) {
        setEditCategory(null);
        setTimeout(() => window.location.reload(), 500);
      }
    } catch (err) {
      console.error('Error saving size:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSize = async (category) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('category', category);
      const response = await fetch(`/app/influencers/${influencer.id}/sizes`, {
        method: 'DELETE',
        body: formData,
      });
      if (response.ok) {
        setTimeout(() => window.location.reload(), 500);
      }
    } catch (err) {
      console.error('Error deleting size:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <button
        type="button"
        onClick={() => navigate(`/app/influencers/${influencer.id}`)}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '13px',
          color: C.textSub,
          cursor: 'pointer',
          marginBottom: '20px',
          padding: 0,
        }}
      >
        ← Back to Influencer
      </button>

      <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '8px' }}>
        Saved Sizes for {influencer.handle}
      </h2>
      <p style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '32px' }}>
        Set default sizes by category for seeding products.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        {CATEGORIES.map(({ key, label }) => {
          const savedSize = sizeMap[key];
          const isEditing = editCategory === key;
          const sizes = SIZE_OPTIONS[key] || [];

          if (isEditing) {
            return (
              <div key={key} style={{ ...card.base }}>
                <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>{label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '12px' }}>
                  {sizes.map(size => (
                    <button
                      key={size}
                      type="button"
                      disabled={loading}
                      onClick={() => handleSaveSize(key, size)}
                      style={{
                        padding: '8px 6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        border: `2px solid ${savedSize === size ? C.accent : '#E3E3E3'}`,
                        backgroundColor: savedSize === size ? C.accentFaint : '#FFFFFF',
                        color: savedSize === size ? C.accent : '#6B7280',
                        borderRadius: '6px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      {size}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setEditCategory(null)}
                  style={{
                    ...btn.secondary,
                    width: '100%',
                    fontSize: '12px',
                    padding: '7px 12px',
                    opacity: loading ? 0.6 : 1,
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            );
          }

          return (
            <div key={key} style={{ ...card.base }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '14px', fontWeight: '700' }}>{label}</div>
                {savedSize && (
                  <div style={{ fontSize: '12px', fontWeight: '700', color: C.accent, backgroundColor: C.accentFaint, padding: '3px 10px', borderRadius: '12px' }}>
                    {savedSize}
                  </div>
                )}
              </div>
              <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px' }}>
                {savedSize ? `Set to: ${savedSize}` : 'Not set'}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setEditCategory(key)}
                  style={{
                    ...btn.secondary,
                    flex: 1,
                    fontSize: '12px',
                    padding: '7px 12px',
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {savedSize ? 'Change' : 'Set'}
                </button>
                {savedSize && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleDeleteSize(key)}
                    style={{
                      ...btn.secondary,
                      flex: 1,
                      fontSize: '12px',
                      padding: '7px 12px',
                      color: '#DC2626',
                      borderColor: '#FCA5A5',
                      backgroundColor: '#FEF2F2',
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ ...card.base, backgroundColor: '#F9FAFB', marginTop: '24px', borderLeft: `3px solid ${C.accent}` }}>
        <div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px' }}>ℹ️ How it works</div>
        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#6B7280', lineHeight: '1.6' }}>
          <li>Saved sizes auto-apply when creating seedings</li>
          <li>You can override per seeding</li>
          <li>Leave empty to require manual selection</li>
        </ul>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
