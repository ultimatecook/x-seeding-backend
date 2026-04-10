import { useLoaderData, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { requirePermission } from '../utils/portal-permissions';
import { fmtDate, fmtNum } from '../theme';

const D = {
  bg:          '#F7F8FA',
  surface:     '#FFFFFF',
  surfaceHigh: '#F3F4F6',
  border:      '#E8E9EC',
  borderLight: '#F0F1F3',
  accent:      '#7C6FF7',
  text:        '#111827',
  textSub:     '#6B7280',
  textMuted:   '#9CA3AF',
  shadow:      '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewCampaigns');
  const campaigns = await prisma.campaign.findMany({
    where:   { shop },
    include: { products: true, _count: { select: { seedings: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { campaigns };
}

export default function PortalCampaigns() {
  const { campaigns } = useLoaderData();

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
            Campaigns
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: D.textSub }}>
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px',
          border: `2px dashed ${D.border}`, borderRadius: '12px', color: D.textMuted,
        }}>
          <p style={{ margin: 0, fontSize: '15px', color: D.textSub }}>No campaigns yet.</p>
          <p style={{ margin: '6px 0 0', fontSize: '13px' }}>Campaigns are created in the Shopify admin app.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {campaigns.map(c => (
            <Link
              key={c.id}
              to={`/portal/campaigns/${c.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div style={{
                backgroundColor: D.surface,
                border: `1px solid ${D.border}`,
                borderRadius: '12px',
                padding: '18px 20px',
                boxShadow: D.shadow,
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center',
                gap: '16px',
                transition: 'box-shadow 0.15s, border-color 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.09)'; e.currentTarget.style.borderColor = D.accent; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = D.shadow; e.currentTarget.style.borderColor = D.border; }}
              >
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: D.text, marginBottom: '5px' }}>
                    {c.title}
                  </div>
                  <div style={{ fontSize: '12px', color: D.textSub, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span>{c._count.seedings} seeding{c._count.seedings !== 1 ? 's' : ''}</span>
                    <span>{c.products.length} product{c.products.length !== 1 ? 's' : ''}</span>
                    {c.budget != null && <span style={{ color: D.accent, fontWeight: '700' }}>€{fmtNum(c.budget)} budget</span>}
                    <span>{fmtDate(c.createdAt, 'medium')}</span>
                  </div>

                  {c.products.length > 0 && (
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {c.products.map(p => (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          fontSize: '11px', color: D.textSub,
                          backgroundColor: D.bg, border: `1px solid ${D.borderLight}`,
                          borderRadius: '6px', padding: '3px 8px',
                        }}>
                          {p.imageUrl && <img src={p.imageUrl} alt={p.productName} style={{ width: '16px', height: '16px', objectFit: 'cover', borderRadius: '3px' }} />}
                          {p.productName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '13px', color: D.accent, fontWeight: '700' }}>View →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
