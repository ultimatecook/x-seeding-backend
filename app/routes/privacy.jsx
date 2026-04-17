// zeedy.xyz/privacy — standalone page, no auth required

const P = {
  accent:  '#7C6FF7',
  border:  '#E5E3F0',
  text:    '#1A1523',
  textSub: '#6B6880',
  textMuted: '#A09CB8',
  bg:      '#F7F6FB',
  surface: '#FFFFFF',
  shadow:  '0 1px 4px rgba(124,111,247,0.08), 0 4px 16px rgba(0,0,0,0.04)',
};

const LAST_UPDATED = 'April 17, 2026';
const CONTACT_EMAIL = 'privacy@zeedy.xyz';
const APP_URL = 'https://zeedy.xyz';

export default function PrivacyPolicy() {
  return (
    <div style={{ backgroundColor: P.bg, minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '60px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: '48px' }}>
          <a href={APP_URL} style={{ textDecoration: 'none' }}>
            <img src="/namelogo.svg" alt="Zeedy" style={{ height: '32px', marginBottom: '40px', display: 'block' }} />
          </a>
          <h1 style={{ margin: '0 0 10px', fontSize: '32px', fontWeight: '800', color: P.text, letterSpacing: '-0.5px' }}>
            Privacy Policy
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: P.textMuted }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>

        {/* Content */}
        <div style={{ backgroundColor: P.surface, border: `1px solid ${P.border}`, borderRadius: '16px', padding: '40px 44px', boxShadow: P.shadow, lineHeight: 1.75 }}>

          <Section title="1. Who We Are">
            <p>Zeedy ("we", "our", or "us") is a Shopify app and web portal that helps brands manage influencer seeding campaigns. We are operated by Zeedy and can be reached at <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>{CONTACT_EMAIL}</a>.</p>
            <p>This Privacy Policy explains what data we collect, why we collect it, how we use it, and your rights regarding that data.</p>
          </Section>

          <Section title="2. Data We Collect">
            <p><strong style={{ color: P.text }}>From Shopify merchants (store owners and staff):</strong></p>
            <ul style={listStyle}>
              <li>Shopify store domain and access tokens (used to fetch products and create draft orders on your behalf)</li>
              <li>Name and email address of the portal account holder</li>
              <li>App usage data: campaigns, seedings, and influencer records you create within Zeedy</li>
            </ul>
            <p><strong style={{ color: P.text }}>From influencers:</strong></p>
            <ul style={listStyle}>
              <li>Social media handle, name, email address, country, and follower count — entered manually by the merchant</li>
              <li>Shipping address — collected when an influencer completes the checkout for a seeding draft order</li>
              <li>Clothing sizes — optionally stored to pre-fill future seedings</li>
            </ul>
            <p><strong style={{ color: P.text }}>Automatically collected:</strong></p>
            <ul style={listStyle}>
              <li>Server logs (IP addresses, request timestamps) for security and debugging — retained for 30 days</li>
              <li>Session cookies required for portal authentication</li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Data">
            <ul style={listStyle}>
              <li>To provide the Zeedy service: creating draft orders, tracking seeding status, and managing influencer records</li>
              <li>To authenticate portal users and maintain secure sessions</li>
              <li>To send invite links to team members you add to your portal</li>
              <li>To comply with legal obligations, including GDPR data subject requests</li>
            </ul>
            <p>We do not sell your data. We do not share your data with third parties except as described in Section 5.</p>
          </Section>

          <Section title="4. Legal Basis for Processing (GDPR)">
            <p>If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, we process your personal data on the following legal bases:</p>
            <ul style={listStyle}>
              <li><strong style={{ color: P.text }}>Contract performance</strong> — processing necessary to deliver the Zeedy service you have subscribed to</li>
              <li><strong style={{ color: P.text }}>Legitimate interests</strong> — security logging, fraud prevention, and service improvement</li>
              <li><strong style={{ color: P.text }}>Legal obligation</strong> — responding to GDPR data subject requests and complying with applicable laws</li>
            </ul>
          </Section>

          <Section title="5. Data Sharing">
            <p>We share data only in these limited circumstances:</p>
            <ul style={listStyle}>
              <li><strong style={{ color: P.text }}>Shopify</strong> — we use the Shopify Admin API to fetch product information and create draft orders. Shopify's own privacy policy governs their handling of that data.</li>
              <li><strong style={{ color: P.text }}>Infrastructure providers</strong> — we use Neon (PostgreSQL hosting) and Vercel/Render for server hosting. These providers process data only as instructed and under data processing agreements.</li>
              <li><strong style={{ color: P.text }}>Legal requirements</strong> — we may disclose data if required by law, court order, or to protect our legal rights.</li>
            </ul>
          </Section>

          <Section title="6. Data Retention">
            <p>We retain your data for as long as your Shopify store has Zeedy installed. When you uninstall the app, we begin the deletion process. All store data (influencers, seedings, campaigns, portal users) is permanently deleted within 48 hours of uninstallation in accordance with Shopify's GDPR requirements.</p>
          </Section>

          <Section title="7. Your Rights">
            <p>Depending on your location, you may have the following rights regarding your personal data:</p>
            <ul style={listStyle}>
              <li><strong style={{ color: P.text }}>Access</strong> — request a copy of the data we hold about you</li>
              <li><strong style={{ color: P.text }}>Rectification</strong> — ask us to correct inaccurate data</li>
              <li><strong style={{ color: P.text }}>Erasure</strong> — request deletion of your personal data</li>
              <li><strong style={{ color: P.text }}>Restriction</strong> — ask us to limit how we use your data</li>
              <li><strong style={{ color: P.text }}>Portability</strong> — receive your data in a machine-readable format</li>
              <li><strong style={{ color: P.text }}>Objection</strong> — object to processing based on legitimate interests</li>
            </ul>
            <p>To exercise any of these rights, contact us at <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>{CONTACT_EMAIL}</a>. We will respond within 30 days.</p>
            <p>For influencer data deletion requests, merchants can redact records directly within the Zeedy portal, or contact us and we will process the request manually.</p>
          </Section>

          <Section title="8. Cookies">
            <p>The Zeedy portal uses a single first-party session cookie (<code style={codeStyle}>__portal_session</code>) strictly to keep you logged in. We do not use advertising cookies or third-party tracking.</p>
            <p>The Shopify embedded app component uses cookies set by Shopify's App Bridge for authentication. These are governed by Shopify's cookie policy.</p>
          </Section>

          <Section title="9. Security">
            <p>We protect your data using industry-standard measures: all data is encrypted in transit (TLS), passwords are hashed using scrypt, and access tokens are stored securely in our database. We conduct regular security reviews of our codebase.</p>
          </Section>

          <Section title="10. Children's Privacy">
            <p>Zeedy is a business tool intended for use by adults. We do not knowingly collect personal data from anyone under the age of 18.</p>
          </Section>

          <Section title="11. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. We will notify active merchants of material changes by updating the "Last updated" date at the top of this page. Continued use of Zeedy after changes are posted constitutes acceptance of the updated policy.</p>
          </Section>

          <Section title="12. Contact Us" last>
            <p>If you have any questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us:</p>
            <div style={{ backgroundColor: P.bg, border: `1px solid ${P.border}`, borderRadius: '10px', padding: '16px 20px', marginTop: '12px' }}>
              <div style={{ fontSize: '14px', color: P.text }}>
                <div><strong>Email:</strong> <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>{CONTACT_EMAIL}</a></div>
                <div style={{ marginTop: '4px' }}><strong>Website:</strong> <a href={APP_URL} style={linkStyle}>{APP_URL}</a></div>
              </div>
            </div>
          </Section>

        </div>

        {/* Footer */}
        <div style={{ marginTop: '32px', textAlign: 'center', fontSize: '13px', color: P.textMuted }}>
          <a href={APP_URL} style={{ color: P.accent, textDecoration: 'none', fontWeight: '600' }}>← Back to Zeedy</a>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Section({ title, children, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : '32px', paddingBottom: last ? 0 : '32px', borderBottom: last ? 'none' : `1px solid ${P.border}` }}>
      <h2 style={{ margin: '0 0 14px', fontSize: '17px', fontWeight: '700', color: P.text, letterSpacing: '-0.2px' }}>
        {title}
      </h2>
      <div style={{ fontSize: '14px', color: P.textSub }}>
        {children}
      </div>
    </div>
  );
}

const linkStyle = { color: P.accent, textDecoration: 'none', fontWeight: '600' };
const codeStyle = { fontFamily: 'monospace', fontSize: '12px', backgroundColor: P.bg, padding: '2px 6px', borderRadius: '4px', color: P.text };
const listStyle = { margin: '8px 0 12px', paddingLeft: '20px', display: 'grid', gap: '6px' };
