import { useState, useEffect } from 'react';
import { useLoaderData, useNavigate, Form, redirect } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card, section, input } from '../theme';

// Common size options by category
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

// ── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ params }) {
  const id = parseInt(params.id);

  const influencer = await prisma.influencer.findUnique({
    where: { id },
    include: { savedSizes: true },
  });

  if (!influencer) throw new Response('Influencer not found', { status: 404 });

  // Convert to category -> size map
  const sizeMap = {};
  influencer.savedSizes.forEach(ss => {
    sizeMap[ss.category] = ss.size;
  });

  return { influencer, sizeMap };
}

// ── Action ───────────────────────────────────────────────────────────────────
export async function action({ request, params }) {
  const influencerId = parseInt(params.id);

  if (request.method === 'POST') {
    const formData = await request.formData();
    const category = formData.get('category');
    const size = formData.get('size');

    if (!category || !size) {
      return new Response(JSON.stringify({ error: 'Category and size required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      await prisma.influencerSavedSize.upsert({
        where: { influencerId_category: { influencerId, category } },
        update: { size },
        create: { influencerId, category, size },
      });

      return redirect(`/app/influencers/${influencerId}/sizes`);
    } catch (err) {
      console.error('Error saving size:', err);
      return new Response(JSON.stringify({ error: 'Server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (request.method === 'DELETE') {
    try {
      const formData = await request.formData();
      const category = formData.get('category');

      if (!category) {
        return new Response(JSON.stringify({ error: 'Category required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Try to delete - will silently succeed if not found
      await prisma.influencerSavedSize.deleteMany({
        where: { influencerId, category },
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Error deleting size:', err);
      return new Response(JSON.stringify({ error: 'Server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Component ────────────────────────────────────────────────────────────────
export default function InfluencerSizes() {
  const { influencer, sizeMap } = useLoaderData();
  const navigate = useNavigate();
  const [editCategory, setEditCategory] = useState(null);

  return (
    <div>
      {/* Back link */}
      <button
        type="button"
        onClick={() => navigate(`/app/influencers/${influencer.id}`)}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '13px',
          color: C.textSub,
          textDecoration: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          marginBottom: '20px',
          padding: 0,
        }}
      >
        ← Back to Influencer
      </button>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ margin: '0 0 4px', color: '#1A1A1A', fontSize: '22px', fontWeight: '800' }}>
          Saved Sizes for {influencer.handle}
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: '#9CA3AF' }}>
          Set default sizes by category for seeding products. These will auto-apply when you create new seedings.
        </p>
      </div>

      {/* Grid of category cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {CATEGORIES.map(({ key, label }) => {
          const savedSize = sizeMap[key];
          const isEditing = editCategory === key;
          const availableSizes = SIZE_OPTIONS[key] || [];

          return (
            <div key={key} style={{ ...card.base, display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>{label}</div>
                {savedSize && !isEditing && (
                  <div style={{ fontSize: '12px', fontWeight: '700', color: C.accent, backgroundColor: C.accentFaint, padding: '3px 10px', borderRadius: '12px' }}>
                    {savedSize}
                  </div>
                )}
              </div>

              {/* Size selector or display */}
              {!isEditing ? (
                <div>
                  {savedSize ? (
                    <div style={{ fontSize: '13px', color: C.textSub, marginBottom: '12px' }}>
                      Default size: <strong style={{ color: C.text }}>{savedSize}</strong>
                    </div>
                  ) : (
                    <div style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '12px', fontStyle: 'italic' }}>
                      No default size set
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setEditCategory(key)}
                      style={{
                        ...btn.secondary,
                        flex: 1,
                        fontSize: '12px',
                        padding: '7px 12px',
                      }}
                    >
                      {savedSize ? 'Change' : 'Set Size'}
                    </button>
                    {savedSize && (
                      <button
                        type="button"
                        onClick={async () => {
                          const formData = new FormData();
                          formData.append('category', key);
                          const res = await fetch(`/app/influencers/${influencer.id}/sizes`, {
                            method: 'DELETE',
                            body: formData,
                          });
                          if (res.ok) navigate(0);
                        }}
                        style={{
                          ...btn.secondary,
                          flex: 1,
                          fontSize: '12px',
                          padding: '7px 12px',
                          color: '#DC2626',
                          borderColor: '#FCA5A5',
                          backgroundColor: '#FEF2F2',
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                // Edit mode
                <Form method="post">
                  <input type="hidden" name="category" value={key} />

                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                      Pick a size
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(50px, 1fr))', gap: '6px', marginBottom: '12px' }}>
                      {availableSizes.map(size => (
                        <button
                          key={size}
                          type="submit"
                          name="size"
                          value={size}
                          style={{
                            padding: '8px 6px',
                            fontSize: '12px',
                            fontWeight: '600',
                            border: `1.5px solid ${savedSize === size ? C.accent : '#E3E3E3'}`,
                            backgroundColor: savedSize === size ? C.accentFaint : '#FFFFFF',
                            color: savedSize === size ? C.accent : '#6B7280',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setEditCategory(null)}
                      style={{
                        ...btn.secondary,
                        flex: 1,
                        fontSize: '12px',
                        padding: '7px 12px',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </Form>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary section */}
      <div style={{ ...card.base, backgroundColor: '#F9FAFB', borderLeft: `3px solid ${C.accent}` }}>
        <div style={{ ...section.title, marginBottom: '10px' }}>ℹ️ How it works</div>
        <ul style={{ margin: '0 0 0 16px', padding: 0, fontSize: '13px', color: C.textSub, lineHeight: '1.6' }}>
          <li>When you create a new seeding, saved sizes are automatically applied to matching product categories</li>
          <li>You can override sizes per seeding if needed</li>
          <li>Leave categories empty to require manual size selection each time</li>
        </ul>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
