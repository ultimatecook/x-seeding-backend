// zeedy.xyz/terms — standalone page, no auth required

const P = {
  accent:   '#7C6FF7',
  border:   '#E5E3F0',
  text:     '#1A1523',
  textSub:  '#6B6880',
  textMuted:'#A09CB8',
  bg:       '#F7F6FB',
  surface:  '#FFFFFF',
  shadow:   '0 1px 4px rgba(124,111,247,0.08), 0 4px 16px rgba(0,0,0,0.04)',
};

const LAST_UPDATED   = 'April 19, 2026';
const CONTACT_EMAIL  = 'legal@zeedy.xyz';
const APP_URL        = 'https://zeedy.xyz';

const h2Style = {
  margin: '40px 0 12px',
  fontSize: '18px',
  fontWeight: '800',
  color: P.text,
  letterSpacing: '-0.3px',
};

const pStyle = {
  margin: '0 0 12px',
  fontSize: '14px',
  color: P.textSub,
  lineHeight: 1.7,
};

const liStyle = {
  fontSize: '14px',
  color: P.textSub,
  lineHeight: 1.7,
  marginBottom: '6px',
};

export default function TermsOfService() {
  return (
    <div style={{ backgroundColor: P.bg, minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '60px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: '48px' }}>
          <a href={APP_URL} style={{ textDecoration: 'none' }}>
            <img src="/namelogo.svg" alt="Zeedy" style={{ height: '32px', marginBottom: '40px', display: 'block' }} />
          </a>
          <h1 style={{ margin: '0 0 10px', fontSize: '32px', fontWeight: '800', color: P.text, letterSpacing: '-0.5px' }}>
            Terms of Service
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: P.textMuted }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>

        {/* Body */}
        <div style={{ backgroundColor: P.surface, border: `1px solid ${P.border}`, borderRadius: '16px', padding: '40px', boxShadow: P.shadow }}>

          <p style={pStyle}>
            These Terms of Service ("Terms") govern your access to and use of Zeedy ("the App"), a Shopify application
            provided by Zeedy ("we", "us", or "our"). By installing or using the App, you agree to be bound by these Terms.
            If you do not agree, do not install or use the App.
          </p>

          <h2 style={h2Style}>1. Use of the App</h2>
          <p style={pStyle}>
            Zeedy is a product seeding management tool for Shopify merchants. You may use the App solely for lawful
            business purposes in connection with your Shopify store. You are responsible for all activity that occurs
            under your account.
          </p>
          <p style={pStyle}>You agree not to:</p>
          <ul style={{ margin: '0 0 12px', paddingLeft: '20px' }}>
            <li style={liStyle}>Use the App for any unlawful or fraudulent purpose</li>
            <li style={liStyle}>Attempt to gain unauthorized access to any part of the App or its infrastructure</li>
            <li style={liStyle}>Reverse engineer, decompile, or disassemble the App</li>
            <li style={liStyle}>Interfere with or disrupt the integrity or performance of the App</li>
          </ul>

          <h2 style={h2Style}>2. Account & Access</h2>
          <p style={pStyle}>
            Access to the Zeedy portal is granted via invite. You are responsible for maintaining the confidentiality
            of your login credentials. You must notify us immediately of any unauthorized use of your account.
            We reserve the right to suspend or terminate accounts that violate these Terms.
          </p>

          <h2 style={h2Style}>3. Shopify Data</h2>
          <p style={pStyle}>
            The App accesses your Shopify store data (products, inventory, draft orders, fulfillments, and locations)
            solely to provide the seeding management features. We do not sell your Shopify data to third parties.
            Our use of Shopify data is governed by the{' '}
            <a href="/privacy" style={{ color: P.accent, fontWeight: '600', textDecoration: 'none' }}>Privacy Policy</a>.
          </p>

          <h2 style={h2Style}>4. Intellectual Property</h2>
          <p style={pStyle}>
            All content, features, and functionality of the App — including but not limited to software, design,
            text, and graphics — are owned by Zeedy and are protected by applicable intellectual property laws.
            You may not copy, modify, or distribute any part of the App without our prior written consent.
          </p>

          <h2 style={h2Style}>5. Billing & Subscription</h2>
          <p style={pStyle}>
            Subscription fees (if applicable) are billed through Shopify's billing system. All fees are
            non-refundable except as required by law or as expressly stated in a separate agreement.
            We reserve the right to change pricing with reasonable notice.
          </p>

          <h2 style={h2Style}>6. Disclaimers</h2>
          <p style={pStyle}>
            The App is provided "as is" and "as available" without warranties of any kind, either express or implied,
            including but not limited to warranties of merchantability, fitness for a particular purpose, or
            non-infringement. We do not warrant that the App will be uninterrupted, error-free, or free of viruses.
          </p>

          <h2 style={h2Style}>7. Limitation of Liability</h2>
          <p style={pStyle}>
            To the fullest extent permitted by law, Zeedy shall not be liable for any indirect, incidental, special,
            consequential, or punitive damages arising from your use of or inability to use the App, even if we have
            been advised of the possibility of such damages. Our total liability to you for any claims arising from
            your use of the App shall not exceed the amounts you paid to us in the twelve months preceding the claim.
          </p>

          <h2 style={h2Style}>8. Indemnification</h2>
          <p style={pStyle}>
            You agree to indemnify and hold Zeedy harmless from any claims, damages, losses, liabilities, and
            expenses (including legal fees) arising from your use of the App, your violation of these Terms,
            or your violation of any rights of a third party.
          </p>

          <h2 style={h2Style}>9. Termination</h2>
          <p style={pStyle}>
            You may stop using the App at any time by uninstalling it from your Shopify store. We may terminate
            or suspend your access to the App at our discretion, with or without notice, if we believe you have
            violated these Terms or for any other legitimate business reason.
          </p>

          <h2 style={h2Style}>10. Changes to These Terms</h2>
          <p style={pStyle}>
            We may update these Terms from time to time. We will notify you of material changes by posting the
            updated Terms on this page with a new "Last updated" date. Continued use of the App after changes
            constitutes your acceptance of the revised Terms.
          </p>

          <h2 style={h2Style}>11. Governing Law</h2>
          <p style={pStyle}>
            These Terms are governed by and construed in accordance with applicable law. Any disputes arising
            from these Terms or your use of the App shall be resolved through good-faith negotiation, and if
            unresolved, through binding arbitration or the courts of competent jurisdiction.
          </p>

          <h2 style={h2Style}>12. Contact</h2>
          <p style={pStyle}>
            If you have questions about these Terms, please contact us at:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: P.accent, fontWeight: '600', textDecoration: 'none' }}>
              {CONTACT_EMAIL}
            </a>
          </p>

        </div>

        {/* Footer */}
        <div style={{ marginTop: '40px', display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/privacy" style={{ fontSize: '13px', color: P.textMuted, textDecoration: 'none' }}>Privacy Policy</a>
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ fontSize: '13px', color: P.textMuted, textDecoration: 'none' }}>Contact</a>
          <a href={APP_URL} style={{ fontSize: '13px', color: P.textMuted, textDecoration: 'none' }}>zeedy.xyz</a>
        </div>

      </div>
    </div>
  );
}
