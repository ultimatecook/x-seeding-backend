import { useState, useEffect } from 'react';
import { useLoaderData, useNavigate, useRouteError, Form, useNavigation } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card } from '../theme';

const SIZE_OPTIONS = {
  tops:     ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'One Size'],
  bottoms:  ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'One Size'],
  footwear: ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', 'One Size'],
};

const CATEGORIES = [
  { key: 'tops',     label: '👕 Tops' },
  { key: 'bottoms',  label: '👖 Bottoms' },
  { key: 'footwear', label: '👟 Footwear' },
];

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ params }) {
  const id = parseInt(params.id);
  const influencer = await prisma.influencer.findUnique({
    where: { id },
    include: { savedSizes: true },
  });
  if (!influencer) throw new Response('Influencer not found', { status: 404 });

  const sizeMap = {};
  influencer.savedSizes.forEach(ss => { sizeMap[ss.category] = ss.size; });

  return { influencer, sizeMap };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request, params }) {
  const influencerId = parseInt(params.id);
  const formData     = await request.formData();
  const intent       = formData.get('intent');
  const category     = formData.get('category');

  if (intent === 'save') {
    const size = formData.get('size');
    await prisma.influencerSavedSize.upsert({
      where:  { influencerId_category: { influencerId, category } },
      update: { size },
      create: { influencerId, category, size },
    });
  }

  if (intent === 'clear') {
    await prisma.influencerSavedSize.deleteMany({
      where: { influencerId, category },
    });
  }

  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function InfluencerSizes() {
  const { influencer, sizeMap } = useLoaderData();
  const navigate    = useNavigate();
  const navigation  = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  const [editCategory, setEditCategory] = useState(null);

  // Close the size picker automatically after the form submission completes
  useEffect(() => {
    if (navigation.state === 'idle' && editCategory !== null) {
      setEditCategory(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation.state]);

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(`/app/influencers/${influencer.id}`)}
        style={{ background: 'none', border: 'none', fontSize: '13px', color: C.textSub, cursor: 'pointer', marginBottom: '20px', padding: 0 }}
      >
        ← Back to Influencer
      </button>

      <h2 style={{ fontSize: '22px', fontWeight: '800', margin: '0 0 6px' }}>
        Saved Sizes · {influencer.handle}
      </h2>
      <p style={{ fontSize: '13px', color: '#9CA3AF', margin: '0 0 28px' }}>
        Default sizes auto-apply when creating new seedings.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {CATEGORIES.map(({ key, label }) => {
          const savedSize = sizeMap[key];
          const isEditing = editCategory === key;
          const sizes     = SIZE_OPTIONS[key] || [];

          return (
            <div key={key} style={{ ...card.base }}>
              {/* Card header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>{label}</span>
                {savedSize && !isEditing && (
                  <span style={{ fontSize: '12px', fontWeight: '700', color: C.accent, backgroundColor: C.accentFaint, padding: '2px 10px', borderRadius: '12px' }}>
                    {savedSize}
                  </span>
                )}
              </div>

              {isEditing ? (
                /* ── Pick a size ── */
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                    Pick a size
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                    {sizes.map(size => (
                      <Form key={size} method="post">
                        <input type="hidden" name="intent"   value="save" />
                        <input type="hidden" name="category" value={key} />
                        <input type="hidden" name="size"     value={size} />
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            fontWeight: '600',
                            border: `2px solid ${savedSize === size ? C.accent : '#E3E3E3'}`,
                            backgroundColor: savedSize === size ? C.accentFaint : '#fff',
                            color: savedSize === size ? C.accent : '#374151',
                            borderRadius: '6px',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            opacity: isSubmitting ? 0.6 : 1,
                          }}
                        >
                          {size}
                        </button>
                      </Form>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditCategory(null)}
                    style={{ ...btn.secondary, width: '100%', fontSize: '12px', padding: '7px 12px' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                /* ── Display mode ── */
                <div>
                  <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px' }}>
                    {savedSize ? `Set to: ${savedSize}` : 'Not set'}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setEditCategory(key)}
                      style={{ ...btn.secondary, flex: 1, fontSize: '12px', padding: '7px 12px' }}
                    >
                      {savedSize ? 'Change' : 'Set Size'}
                    </button>
                    {savedSize && (
                      <Form method="post" style={{ flex: 1 }}>
                        <input type="hidden" name="intent"   value="clear" />
                        <input type="hidden" name="category" value={key} />
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          style={{
                            ...btn.secondary,
                            width: '100%',
                            fontSize: '12px',
                            padding: '7px 12px',
                            color: '#DC2626',
                            borderColor: '#FCA5A5',
                            backgroundColor: '#FEF2F2',
                            opacity: isSubmitting ? 0.6 : 1,
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Clear
                        </button>
                      </Form>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ ...card.base, backgroundColor: '#F9FAFB', marginTop: '24px', borderLeft: `3px solid ${C.accent}` }}>
        <div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px' }}>ℹ️ How it works</div>
        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#6B7280', lineHeight: '1.8' }}>
          <li>Saved sizes auto-apply when you add products to a seeding</li>
          <li>You can override sizes per seeding in the cart</li>
          <li>Leave empty to always require manual selection</li>
        </ul>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
