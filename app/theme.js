// ── X Seeding Manager — Design System ──────────────────────────────────────
// Dark mode, Claude-inspired palette

export const C = {
  // Backgrounds
  bg:          '#1C1917',
  surface:     '#252219',
  surfaceHigh: '#2E2A23',
  overlay:     '#1A1714',

  // Borders
  border:      '#3A3630',
  borderLight: '#2E2A24',

  // Accent — Claude orange
  accent:      '#D97757',
  accentHover: '#C86845',
  accentFaint: '#3A2010',

  // Text
  text:        '#F0EAE0',
  textSub:     '#9A9086',
  textMuted:   '#5C5650',

  // Semantic
  successBg:   '#192B1F',
  successText: '#5BBF7A',
  errorBg:     '#2B1616',
  errorText:   '#E06060',

  // Status badges
  status: {
    Pending:   { background: '#2E2510', color: '#C4962A' },
    Ordered:   { background: '#101C2E', color: '#5A9ED4' },
    Shipped:   { background: '#102A18', color: '#5ABF7A' },
    Delivered: { background: '#10242E', color: '#40AABB' },
    Posted:    { background: '#1E1030', color: '#9A78D4' },
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
    backgroundColor: C.overlay,
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
