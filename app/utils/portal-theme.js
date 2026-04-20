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

// ── Portal-scoped button + input styles (use these instead of btn/input from theme.js) ──
// Rules:
//  primary  → solid purple, ALWAYS white text
//  danger   → red gradient, ALWAYS white text
//  neutral  → clean grey surface, dark text (archive, cancel, back)
//  ghost    → transparent, subtle border, muted text (secondary actions)
export const Pbtn = {
  primary: {
    padding: '9px 22px',
    background: 'linear-gradient(135deg, #7C6FF7 0%, #6558E8 100%)',
    color: '#FFFFFF',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '13px',
    borderRadius: '8px',
    letterSpacing: '-0.1px',
    boxShadow: '0 1px 3px rgba(124,111,247,0.25)',
  },
  danger: {
    padding: '9px 18px',
    background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)',
    color: '#FFFFFF',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '13px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(220,38,38,0.25)',
  },
  neutral: {
    padding: '9px 18px',
    backgroundColor: 'var(--pt-surface-high)',
    color: 'var(--pt-text)',
    border: '1px solid var(--pt-border)',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '13px',
    borderRadius: '8px',
  },
  secondary: {
    padding: '9px 18px',
    backgroundColor: 'transparent',
    color: 'var(--pt-text)',
    border: '1px solid var(--pt-border)',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '13px',
    borderRadius: '8px',
  },
  ghost: {
    padding: '7px 14px',
    backgroundColor: 'transparent',
    color: 'var(--pt-text-sub)',
    border: '1px solid var(--pt-border)',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '12px',
    borderRadius: '8px',
  },
};

export const Pinput = {
  base: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid var(--pt-border)',
    backgroundColor: 'var(--pt-surface)',
    color: 'var(--pt-text)',
    fontSize: '13px',
    outline: 'none',
  },
};

// ── JSX components moved to portal-components.jsx (Vite requires .jsx for JSX syntax) ──
// Re-exported here for backwards compatibility — import from either file.
export { InstagramAvatar, FlagImg } from './portal-components.jsx';

// ── CSS variable references (used in component style props) ──────────────────
export const D = {
  bg:            'var(--pt-bg)',
  surface:       'var(--pt-surface)',
  surfaceHigh:   'var(--pt-surface-high)',
  surfaceRaised: 'var(--pt-surface-raised)',
  border:        'var(--pt-border)',
  borderLight:   'var(--pt-border-light)',
  accent:        'var(--pt-accent)',
  accentHover:   'var(--pt-accent-hover)',
  accentLight:   'var(--pt-accent-light)',
  accentFaint:   'var(--pt-accent-faint)',   // very subtle tint for selections
  accentText:    'var(--pt-accent-text)',
  purple:        'var(--pt-purple)',
  purpleLight:   'var(--pt-purple-light)',
  purpleFaint:   'var(--pt-purple-faint)',
  text:          'var(--pt-text)',
  textSub:       'var(--pt-text-sub)',
  textMuted:     'var(--pt-text-muted)',
  shadow:        'var(--pt-shadow)',
  errorBg:       'var(--pt-error-bg)',
  errorText:     'var(--pt-error-text)',
  warningBg:     'var(--pt-warning-bg)',
  warningText:   'var(--pt-warning-text)',
  radius:        '12px',
  // Status colors
  statusPending:   { bg: 'var(--pt-status-pending-bg)',   color: 'var(--pt-status-pending-text)',   dot: 'var(--pt-status-pending-dot)'   },
  statusOrdered:   { bg: 'var(--pt-status-ordered-bg)',   color: 'var(--pt-status-ordered-text)',   dot: 'var(--pt-status-ordered-dot)'   },
  statusShipped:   { bg: 'var(--pt-status-shipped-bg)',   color: 'var(--pt-status-shipped-text)',   dot: 'var(--pt-status-shipped-dot)'   },
  statusDelivered: { bg: 'var(--pt-status-delivered-bg)', color: 'var(--pt-status-delivered-text)', dot: 'var(--pt-status-delivered-dot)' },
  statusPosted:    { bg: 'var(--pt-status-posted-bg)',    color: 'var(--pt-status-posted-text)',    dot: 'var(--pt-status-posted-dot)'    },
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
  --pt-accent-faint:  #F4F2FF;
  --pt-accent-text:   #5B4CF0;
  --pt-purple:        #7C6FF7;
  --pt-purple-light:  #A78BFA;
  --pt-purple-faint:  #EDE9FF;
  --pt-text:          #1A1523;
  --pt-text-sub:      #6B6880;
  --pt-text-muted:    #A09CB8;
  --pt-shadow:        0 1px 4px rgba(0,0,0,0.07);
  --pt-error-bg:      #FEF2F2;
  --pt-error-text:    #DC2626;
  --pt-warning-bg:    #FFFBEB;
  --pt-warning-text:  #B45309;

  --pt-status-pending-bg:    #FEF9C3;
  --pt-status-pending-text:  #854D0E;
  --pt-status-pending-dot:   #F59E0B;
  --pt-status-ordered-bg:    #DBEAFE;
  --pt-status-ordered-text:  #1E40AF;
  --pt-status-ordered-dot:   #3B82F6;
  --pt-status-shipped-bg:    #EDE9FE;
  --pt-status-shipped-text:  #5B21B6;
  --pt-status-shipped-dot:   #7C6FF7;
  --pt-status-delivered-bg:  #DCFCE7;
  --pt-status-delivered-text:#166534;
  --pt-status-delivered-dot: #22C55E;
  --pt-status-posted-bg:     #F0FDF4;
  --pt-status-posted-text:   #15803D;
  --pt-status-posted-dot:    #4ADE80;
`;

// ── Dark theme values ─────────────────────────────────────────────────────────
export const DARK_THEME = `
  --pt-bg:            #0D0F14;
  --pt-surface:       #151922;
  --pt-surface-high:  #1B2130;
  --pt-surface-raised:#1F2536;
  --pt-border:        #2A3142;
  --pt-border-light:  #222838;
  --pt-accent:        #7CFF6B;
  --pt-accent-hover:  #5CE84A;
  --pt-accent-light:  #122010;
  --pt-accent-faint:  #0A160A;
  --pt-accent-text:   #0A2008;
  --pt-purple:        #A855F7;
  --pt-purple-light:  #C084FC;
  --pt-purple-faint:  #1A0D2E;
  --pt-text:          #E6EAF2;
  --pt-text-sub:      #9AA3B2;
  --pt-text-muted:    #6B7280;
  --pt-shadow:        0 1px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
  --pt-error-bg:      #1F0A0A;
  --pt-error-text:    #F87171;
  --pt-warning-bg:    #1A1200;
  --pt-warning-text:  #FCD34D;

  --pt-status-pending-bg:    #1E1A0A;
  --pt-status-pending-text:  #FCD34D;
  --pt-status-pending-dot:   #FCD34D;
  --pt-status-ordered-bg:    #0A1428;
  --pt-status-ordered-text:  #93C5FD;
  --pt-status-ordered-dot:   #60A5FA;
  --pt-status-shipped-bg:    #1A0D2E;
  --pt-status-shipped-text:  #C084FC;
  --pt-status-shipped-dot:   #C084FC;
  --pt-status-delivered-bg:  #081A0F;
  --pt-status-delivered-text:#7CFF6B;
  --pt-status-delivered-dot: #7CFF6B;
  --pt-status-posted-bg:     #0A1F0A;
  --pt-status-posted-text:   #4CD964;
  --pt-status-posted-dot:    #4CD964;
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
  [data-portal-theme] *,
  [data-portal-theme] *::before,
  [data-portal-theme] *::after {
    transition:
      background-color 0.18s ease,
      border-color     0.18s ease,
      color            0.12s ease,
      box-shadow       0.18s ease;
  }

  /* Dark mode base resets */
  [data-portal-theme="dark"] { color-scheme: dark; }

  /* Scrollbar */
  [data-portal-theme="dark"] ::-webkit-scrollbar       { width: 6px; height: 6px; }
  [data-portal-theme="dark"] ::-webkit-scrollbar-track { background: #0D0F14; }
  [data-portal-theme="dark"] ::-webkit-scrollbar-thumb { background: #2A3142; border-radius: 3px; }
  [data-portal-theme="dark"] ::-webkit-scrollbar-thumb:hover { background: #3A4257; }

  /* Inputs */
  [data-portal-theme="dark"] input,
  [data-portal-theme="dark"] textarea,
  [data-portal-theme="dark"] select {
    background-color: #151922;
    color: #E6EAF2;
    border-color: #2A3142;
  }
  [data-portal-theme="dark"] input::placeholder,
  [data-portal-theme="dark"] textarea::placeholder { color: #6B7280; }
  [data-portal-theme="dark"] input:focus,
  [data-portal-theme="dark"] textarea:focus,
  [data-portal-theme="dark"] select:focus {
    outline: 2px solid #7CFF6B;
    outline-offset: 1px;
    border-color: #7CFF6B;
  }
  [data-portal-theme="dark"] select option { background: #1B2130; color: #E6EAF2; }

  /* Images — slight dim in dark mode */
  [data-portal-theme="dark"] img { opacity: 0.92; }

  /* ── Button interaction states ──────────────────────────────────────────── */

  /* Override global * transition to include filter + transform for buttons */
  [data-portal-theme] button {
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 0.15s ease,
      border-color     0.15s ease,
      color            0.12s ease,
      box-shadow       0.15s ease,
      filter           0.15s ease,
      transform        0.12s ease;
  }

  /* Remove default browser outline — we add our own below */
  [data-portal-theme] button:focus { outline: none; }

  /* Hover — subtle brightness drop works for all background types */
  [data-portal-theme] button:hover:not(:disabled) {
    filter: brightness(0.92);
  }

  /* Active — tactile press feel */
  [data-portal-theme] button:active:not(:disabled) {
    filter: brightness(0.85);
    transform: scale(0.98);
    transition-duration: 0.06s;
  }

  /* Focus-visible — clean brand ring, only on keyboard nav */
  [data-portal-theme] button:focus-visible:not(:disabled) {
    outline: 2px solid rgba(124, 111, 247, 0.45);
    outline-offset: 2px;
  }

  /* Disabled — no hover effects */
  [data-portal-theme] button:disabled {
    cursor: not-allowed;
    filter: none;
    transform: none;
  }
`;
