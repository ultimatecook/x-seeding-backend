/**
 * Portal theme system — CSS custom properties + useTheme hook
 *
 * Light mode: clean white/slate, purple accent
 * Dark mode:  deep charcoal, premium SaaS feel (reference: memberup-style dashboard)
 *
 * Usage in components:
 *   import { D } from '../utils/portal-theme';
 *   <div style={{ background: D.bg, color: D.text }}>
 *
 * The D object references CSS custom properties, so swapping
 * data-theme="dark" on the root element instantly repaints everything.
 */

// ── CSS variable references (used in component style props) ──────────────────
export const D = {
  bg:           'var(--pt-bg)',
  surface:      'var(--pt-surface)',
  surfaceHigh:  'var(--pt-surface-high)',
  surfaceRaised:'var(--pt-surface-raised)',
  border:       'var(--pt-border)',
  borderLight:  'var(--pt-border-light)',
  accent:       'var(--pt-accent)',
  accentHover:  'var(--pt-accent-hover)',
  accentLight:  'var(--pt-accent-light)',
  accentText:   'var(--pt-accent-text)',
  text:         'var(--pt-text)',
  textSub:      'var(--pt-text-sub)',
  textMuted:    'var(--pt-text-muted)',
  shadow:       'var(--pt-shadow)',
  radius:       '12px',
  // Status colors (we use data-attrs so they flip automatically too)
  statusPending:   { bg: 'var(--pt-status-pending-bg)',   color: 'var(--pt-status-pending-text)'   },
  statusOrdered:   { bg: 'var(--pt-status-ordered-bg)',   color: 'var(--pt-status-ordered-text)'   },
  statusShipped:   { bg: 'var(--pt-status-shipped-bg)',   color: 'var(--pt-status-shipped-text)'   },
  statusDelivered: { bg: 'var(--pt-status-delivered-bg)', color: 'var(--pt-status-delivered-text)' },
  statusPosted:    { bg: 'var(--pt-status-posted-bg)',    color: 'var(--pt-status-posted-text)'    },
};

// ── Light theme values ────────────────────────────────────────────────────────
export const LIGHT_THEME = `
  --pt-bg:            #F7F6FB;
  --pt-surface:       #FFFFFF;
  --pt-surface-high:  #F3F2F8;
  --pt-surface-raised:#FAFAFA;
  --pt-border:        #E5E3F0;
  --pt-border-light:  #EFEEFC;
  --pt-accent:        #7C6FF7;
  --pt-accent-hover:  #6558E8;
  --pt-accent-light:  #EDE9FF;
  --pt-accent-text:   #5B4CF0;
  --pt-text:          #1A1523;
  --pt-text-sub:      #6B6880;
  --pt-text-muted:    #A09CB8;
  --pt-shadow:        0 1px 4px rgba(0,0,0,0.07);

  --pt-status-pending-bg:    #FEF9C3;
  --pt-status-pending-text:  #854D0E;
  --pt-status-ordered-bg:    #DBEAFE;
  --pt-status-ordered-text:  #1E40AF;
  --pt-status-shipped-bg:    #EDE9FE;
  --pt-status-shipped-text:  #5B21B6;
  --pt-status-delivered-bg:  #DCFCE7;
  --pt-status-delivered-text:#166534;
  --pt-status-posted-bg:     #F0FDF4;
  --pt-status-posted-text:   #15803D;
`;

// ── Dark theme values ─────────────────────────────────────────────────────────
export const DARK_THEME = `
  --pt-bg:            #111016;
  --pt-surface:       #1A1825;
  --pt-surface-high:  #211F2E;
  --pt-surface-raised:#252333;
  --pt-border:        #2E2B3E;
  --pt-border-light:  #272534;
  --pt-accent:        #9C8FFF;
  --pt-accent-hover:  #B3A9FF;
  --pt-accent-light:  #2A2550;
  --pt-accent-text:   #C4BAFF;
  --pt-text:          #F0EEF8;
  --pt-text-sub:      #9490AE;
  --pt-text-muted:    #5E5B78;
  --pt-shadow:        0 1px 6px rgba(0,0,0,0.35);

  --pt-status-pending-bg:    #2C2410;
  --pt-status-pending-text:  #FCD34D;
  --pt-status-ordered-bg:    #0D1A36;
  --pt-status-ordered-text:  #93C5FD;
  --pt-status-shipped-bg:    #1E1640;
  --pt-status-shipped-text:  #C4B5FD;
  --pt-status-delivered-bg:  #0A2218;
  --pt-status-delivered-text:#6EE7B7;
  --pt-status-posted-bg:     #0A2216;
  --pt-status-posted-text:   #4ADE80;
`;

// ── The full <style> block injected into the portal shell ─────────────────────
export const PORTAL_THEME_CSS = `
  [data-portal-theme] {
    ${LIGHT_THEME}
  }
  [data-portal-theme="dark"] {
    ${DARK_THEME}
  }

  /* Smooth transitions on theme switch */
  [data-portal-theme] * {
    transition:
      background-color 0.2s ease,
      border-color     0.2s ease,
      color            0.15s ease,
      box-shadow       0.2s ease;
  }

  /* Scrollbar theming */
  [data-portal-theme="dark"] ::-webkit-scrollbar-track { background: #1A1825; }
  [data-portal-theme="dark"] ::-webkit-scrollbar-thumb { background: #2E2B3E; border-radius: 3px; }
  [data-portal-theme="dark"] input::placeholder,
  [data-portal-theme="dark"] textarea::placeholder { color: #5E5B78; }
  [data-portal-theme="dark"] input:focus,
  [data-portal-theme="dark"] textarea:focus,
  [data-portal-theme="dark"] select:focus { outline-color: #9C8FFF; }
  [data-portal-theme="dark"] select option { background: #1A1825; color: #F0EEF8; }
`;
