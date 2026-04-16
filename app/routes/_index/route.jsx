import { redirect, Form, useLoaderData, useNavigation } from 'react-router';
import { login } from '../../shopify.server';

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('shop')) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export const action = async ({ request }) => {
  return login(request);
};

const P = {
  accent:      '#7C6FF7',
  accentLight: '#EDE9FF',
  border:      '#E5E3F0',
  bg:          '#F7F6FB',
  surface:     '#FFFFFF',
  text:        '#1A1523',
  textSub:     '#6B6880',
  textMuted:   '#A09CB8',
};

const FEATURES = [
  { icon: '📦', title: 'Seeding management',  desc: 'Create seedings, track status from pending to posted, and auto-generate Shopify draft orders with 100% discount.' },
  { icon: '👥', title: 'Influencer database', desc: 'Store sizes, tiers, countries and history per influencer. Sizes auto-fill on repeat sends.' },
  { icon: '🎯', title: 'Campaign tracking',   desc: 'Group seedings into campaigns and track spend across all your influencer marketing.' },
  { icon: '🌐', title: 'Influencer portal',   desc: 'Invite influencers to submit their address and track their packages — no login required for you.' },
];

export default function Index() {
  const { showForm } = useLoaderData();
  const navigation   = useNavigation();
  const loading      = navigation.state !== 'idle';

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: P.bg,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      color: P.text,
    }}>

      {/* Nav */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        backgroundColor: 'rgba(247,246,251,0.9)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${P.border}`,
        padding: '0 40px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <img src="/fullname.png" alt="ZEEDY" style={{ height: '26px', width: 'auto', display: 'block' }} />
        <a href="/portal-login" style={{
          fontSize: '13px', fontWeight: '700', color: P.accent,
          textDecoration: 'none', padding: '7px 16px',
          border: `1.5px solid ${P.accentLight}`,
          borderRadius: '8px', backgroundColor: P.accentLight,
        }}>
          Admin login →
        </a>
      </nav>

      {/* Hero */}
      <section style={{
        maxWidth: '760px', margin: '0 auto',
        padding: '48px 24px 56px',
        textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          backgroundColor: P.accentLight, border: `1px solid ${P.border}`,
          borderRadius: '20px', padding: '5px 14px',
          fontSize: '12px', fontWeight: '700', color: P.accent,
          marginBottom: '28px', letterSpacing: '0.3px',
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: P.accent }} />
          Shopify influencer seeding — made simple
        </div>

        <h1 style={{
          margin: '0 0 20px',
          fontSize: 'clamp(36px, 6vw, 56px)',
          fontWeight: '900', letterSpacing: '-1.5px', lineHeight: 1.1,
        }}>
          Send product. Track everything.<br />
          <span style={{ color: P.accent }}>Scale your seedings.</span>
        </h1>

        <p style={{
          margin: '0 0 44px',
          fontSize: '17px', color: P.textSub, lineHeight: 1.7,
          maxWidth: '520px', marginLeft: 'auto', marginRight: 'auto',
        }}>
          Zeedy connects to your Shopify store so you can manage influencer gifting,
          track packages, and run campaigns — all in one place.
        </p>

        {/* Install form */}
        {showForm && (
          <div style={{
            backgroundColor: P.surface, border: `1px solid ${P.border}`,
            borderRadius: '16px', padding: '28px 32px',
            boxShadow: '0 4px 24px rgba(124,111,247,0.1)',
            maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto',
          }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: P.text, marginBottom: '16px' }}>
              Install on your Shopify store
            </div>
            <Form method="post" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                type="text" name="shop" required
                placeholder="your-store.myshopify.com"
                style={{
                  padding: '11px 14px', borderRadius: '9px',
                  border: `1.5px solid ${P.border}`,
                  fontSize: '14px', color: P.text, backgroundColor: P.bg,
                  outline: 'none', width: '100%', boxSizing: 'border-box',
                }}
              />
              <button type="submit" disabled={loading} style={{
                padding: '12px',
                background: loading ? P.accentLight : 'linear-gradient(135deg, #7C6FF7 0%, #5B4CF0 100%)',
                color: loading ? P.accent : '#fff',
                border: 'none', borderRadius: '9px',
                fontSize: '14px', fontWeight: '700',
                cursor: loading ? 'wait' : 'pointer',
                boxShadow: loading ? 'none' : '0 4px 12px rgba(124,111,247,0.35)',
              }}>
                {loading ? 'Connecting…' : 'Install Zeedy →'}
              </button>
            </Form>
            <p style={{ margin: '12px 0 0', fontSize: '12px', color: P.textMuted }}>
              Free to install · Requires a Shopify store
            </p>
          </div>
        )}
      </section>

      {/* Features */}
      <section style={{
        maxWidth: '960px', margin: '0 auto', padding: '0 24px 80px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px',
      }}>
        {FEATURES.map(f => (
          <div key={f.title} style={{
            backgroundColor: P.surface, border: `1px solid ${P.border}`,
            borderRadius: '14px', padding: '24px',
            boxShadow: '0 1px 4px rgba(124,111,247,0.06)',
          }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>{f.icon}</div>
            <div style={{ fontSize: '14px', fontWeight: '800', color: P.text, marginBottom: '8px' }}>{f.title}</div>
            <div style={{ fontSize: '13px', color: P.textSub, lineHeight: 1.6 }}>{f.desc}</div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: `1px solid ${P.border}`, padding: '24px 40px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '12px',
      }}>
        <img src="/fullname.png" alt="ZEEDY" style={{ height: '20px', width: 'auto', display: 'block' }} />
        <span style={{ fontSize: '12px', color: P.textMuted }}>
          © {new Date().getFullYear()} Zeedy · Shopify influencer seeding
        </span>
        <a href="/portal-login" style={{ fontSize: '12px', color: P.accent, fontWeight: '600', textDecoration: 'none' }}>
          Admin login →
        </a>
      </footer>
    </div>
  );
}
