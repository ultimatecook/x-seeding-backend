import { useLoaderData, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';

const P = {
  accent:      '#7C6FF7',
  accentHover: '#6558E8',
  accentLight: '#EDE9FF',
  accentFaint: '#F4F2FF',
  border:      '#E5E3F0',
  bg:          '#F7F6FB',
  surface:     '#FFFFFF',
  text:        '#1A1523',
  textSub:     '#6B6880',
  textMuted:   '#A09CB8',
  shadow:      '0 1px 4px rgba(124,111,247,0.08), 0 4px 16px rgba(0,0,0,0.04)',
};

const STATUS_META = {
  Pending:   { bg: '#FFFBEB', text: '#B45309', dot: '#F59E0B' },
  Ordered:   { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
  Shipped:   { bg: '#EDE9FE', text: '#5B21B6', dot: '#7C6FF7' },
  Delivered: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
  Posted:    { bg: '#F0FDF4', text: '#15803D', dot: '#4ADE80' },
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [totalSeedings, totalInfluencers, totalCampaigns, statusCounts] = await Promise.all([
    prisma.seeding.count({ where: { shop } }),
    prisma.influencer.count({ where: { shop, archived: false } }),
    prisma.campaign.count({ where: { shop } }),
    prisma.seeding.groupBy({ by: ['status'], where: { shop }, _count: { _all: true } }),
  ]);

  const byStatus = {};
  for (const row of statusCounts) byStatus[row.status] = row._count._all;

  return { shop, totalSeedings, totalInfluencers, totalCampaigns, byStatus };
}

function StatCard({ label, value, icon }) {
  return (
    <div style={{
      backgroundColor: P.surface,
      border: `1px solid ${P.border}`,
      borderRadius: '14px',
      padding: '22px 24px',
      boxShadow: P.shadow,
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    }}>
      <div style={{
        width: '44px', height: '44px', borderRadius: '12px',
        backgroundColor: P.accentFaint,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '20px', flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: '28px', fontWeight: '800', color: P.text, letterSpacing: '-0.5px', lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: '12px', color: P.textSub, fontWeight: '600', marginTop: '2px' }}>
          {label}
        </div>
      </div>
    </div>
  );
}

export default function AppIndex() {
  const { totalSeedings, totalInfluencers, totalCampaigns, byStatus } = useLoaderData();

  const statuses = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];
  const activeStatuses = statuses.filter(s => (byStatus[s] || 0) > 0);

  return (
    <div style={{
      maxWidth: '680px',
      margin: '0 auto',
      padding: '48px 24px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '32px',
    }}>

      {/* Logo */}
      <div>
        <img src="/fullname.png" alt="ZEEDY" style={{ height: '40px', width: 'auto', display: 'block' }} />
      </div>

      {/* Hero card */}
      <div style={{
        width: '100%',
        backgroundColor: P.surface,
        border: `1px solid ${P.border}`,
        borderRadius: '20px',
        padding: '40px',
        boxShadow: P.shadow,
        textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          backgroundColor: P.accentFaint,
          border: `1px solid ${P.accentLight}`,
          borderRadius: '20px',
          padding: '5px 14px',
          fontSize: '12px',
          fontWeight: '700',
          color: P.accent,
          marginBottom: '20px',
          letterSpacing: '0.3px',
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: P.accent }} />
          Connected to Shopify
        </div>

        <h1 style={{
          margin: '0 0 10px',
          fontSize: '26px',
          fontWeight: '800',
          color: P.text,
          letterSpacing: '-0.5px',
        }}>
          Your store is connected
        </h1>
        <p style={{
          margin: '0 0 32px',
          fontSize: '14px',
          color: P.textSub,
          lineHeight: 1.6,
          maxWidth: '380px',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          Manage your seedings, influencers, and campaigns from the full Zeedy app.
          Everything lives at <strong style={{ color: P.text }}>zeedy.xyz</strong>.
        </p>

        <a
          href="https://zeedy.xyz/portal"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '14px 32px',
            background: 'linear-gradient(135deg, #7C6FF7 0%, #5B4CF0 100%)',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '12px',
            fontSize: '15px',
            fontWeight: '700',
            boxShadow: '0 4px 14px rgba(124,111,247,0.4)',
            letterSpacing: '-0.1px',
            transition: 'opacity 0.15s',
          }}
        >
          Open Zeedy
          <span style={{ fontSize: '16px' }}>→</span>
        </a>
      </div>

      {/* Stats row */}
      <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <StatCard label="Total Seedings"  value={totalSeedings}    icon="📦" />
        <StatCard label="Influencers"     value={totalInfluencers} icon="👤" />
        <StatCard label="Campaigns"       value={totalCampaigns}   icon="🎯" />
      </div>

      {/* Pipeline status */}
      {activeStatuses.length > 0 && (
        <div style={{
          width: '100%',
          backgroundColor: P.surface,
          border: `1px solid ${P.border}`,
          borderRadius: '16px',
          padding: '24px',
          boxShadow: P.shadow,
        }}>
          <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: P.textMuted, marginBottom: '16px' }}>
            Seeding pipeline
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {activeStatuses.map(s => {
              const m = STATUS_META[s];
              const count = byStatus[s] || 0;
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: m.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', fontWeight: '600', color: P.textSub }}>{s}</span>
                  </div>
                  <span style={{
                    fontSize: '12px', fontWeight: '800',
                    backgroundColor: m.bg, color: m.text,
                    padding: '2px 10px', borderRadius: '20px',
                  }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer note */}
      <p style={{ fontSize: '12px', color: P.textMuted, textAlign: 'center', margin: 0 }}>
        This Shopify integration handles authentication and product sync.
        <br />All features are available at <a href="https://zeedy.xyz/portal" target="_blank" rel="noreferrer" style={{ color: P.accent, fontWeight: '600', textDecoration: 'none' }}>zeedy.xyz/portal</a>.
      </p>

    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
