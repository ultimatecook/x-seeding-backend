// ── X Seeding Manager — Design System ──────────────────────────────────────
// Light mode, seamless with Shopify admin, Claude orange accents

export const C = {
  // Backgrounds — matches Shopify admin palette
  bg:          '#F6F6F7',   // Shopify page background
  surface:     '#FFFFFF',   // cards, panels
  surfaceHigh: '#F1F1F1',   // elevated/inner panels, greyish cards
  overlay:     '#FAFAFA',   // inputs, subtle fills

  // Borders
  border:      '#E3E3E3',
  borderLight: '#EBEBEB',

  // Accent — Claude orange
  accent:      '#D97757',
  accentHover: '#C86845',
  accentFaint: '#FDF0EB',   // very light orange tint for selected states

  // Text
  text:        '#1A1A1A',
  textSub:     '#6B7280',
  textMuted:   '#9CA3AF',

  // Semantic
  successBg:   '#F0FDF4',
  successText: '#166534',
  errorBg:     '#FEF2F2',
  errorText:   '#DC2626',

  // Status badges — readable on light background
  status: {
    Pending:   { background: '#FEF9C3', color: '#854D0E' },
    Ordered:   { background: '#DBEAFE', color: '#1E40AF' },
    Shipped:   { background: '#DCFCE7', color: '#166534' },
    Delivered: { background: '#CFFAFE', color: '#155E75' },
    Posted:    { background: '#F3E8FF', color: '#6B21A8' },
  },
};

// ── Reusable style objects ──────────────────────────────────────────────────

export const btn = {
  primary: {
    padding: '9px 22px',
    backgroundColor: C.accent,
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '13px',
    borderRadius: '6px',
  },
  secondary: {
    padding: '9px 18px',
    backgroundColor: 'transparent',
    color: C.text,
    border: `1px solid ${C.border}`,
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '13px',
    borderRadius: '6px',
  },
  ghost: {
    padding: '7px 14px',
    backgroundColor: 'transparent',
    color: C.textSub,
    border: `1px solid ${C.border}`,
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '12px',
    borderRadius: '6px',
  },
  danger: {
    padding: '9px 18px',
    backgroundColor: 'transparent',
    color: C.errorText,
    border: `1px solid ${C.border}`,
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '13px',
    borderRadius: '6px',
  },
};

export const input = {
  base: {
    padding: '9px 12px',
    border: `1px solid ${C.border}`,
    backgroundColor: C.surface,
    color: C.text,
    fontSize: '13px',
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: '6px',
    outline: 'none',
  },
};

export const card = {
  base: {
    backgroundColor: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: '8px',
    padding: '20px',
  },
  flat: {
    backgroundColor: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: '8px',
  },
};

export const label = {
  base: {
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    color: C.textSub,
  },
};

export const section = {
  title: {
    fontSize: '11px',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    color: C.textSub,
    marginBottom: '14px',
  },
};
