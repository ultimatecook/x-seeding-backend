import { useLoaderData, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { C, card, fmtDate } from '../theme';

export async function loader({ request }) {
  const { shop } = await requirePortalUser(request);
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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: C.text }}>
          Campaigns <span style={{ fontSize: '14px', fontWeight: '400', color: C.textMuted }}>({campaigns.length})</span>
        </h2>
      </div>

      {campaigns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          <p style={{ margin: 0 }}>No campaigns yet. Campaigns are created in the Shopify admin app.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {campaigns.map(c => (
            <div key={c.id} style={{ ...card.base, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start', gap: '12px' }}>
              <div>
                <div style={{ fontWeight: '700', color: C.text, fontSize: '15px', marginBottom: '4px' }}>{c.title}</div>
                <div style={{ fontSize: '12px', color: C.textSub }}>
                  {c._count.seedings} seeding{c._count.seedings !== 1 ? 's' : ''}
                  {c.budget ? ` · Budget: €${c.budget.toFixed(2)}` : ''}
                  {' · '}{fmtDate(c.createdAt)}
                </div>
                {c.products.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {c.products.map(p => (
                      <span key={p.id} style={{ fontSize: '11px', backgroundColor: C.surfaceHigh, borderRadius: '4px', padding: '3px 8px', color: C.textSub, border: `1px solid ${C.borderLight}` }}>
                        {p.productName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Link
                to={`/portal/seedings?campaign=${c.id}`}
                style={{ fontSize: '12px', color: C.accent, fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                View seedings →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
