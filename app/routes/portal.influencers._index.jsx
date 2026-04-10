import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtNum } from '../theme';

// ── Design tokens ─────────────────────────────────────────────────────────────
const D = {
  bg:          '#F7F8FA',
  surface:     '#FFFFFF',
  surfaceHigh: '#F3F4F6',
  border:      '#E8E9EC',
  borderLight: '#F0F1F3',
  accent:      '#7C6FF7',
  accentLight: '#EEF0FE',
  text:        '#111827',
  textSub:     '#6B7280',
  textMuted:   '#9CA3AF',
  shadow:      '0 1px 3px rgba(0,0,0,0.06)',
  successBg:   '#F0FDF4',
  successText: '#15803D',
  errorBg:     '#FEF2F2',
  errorText:   '#DC2626',
};

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Argentina','Armenia','Australia','Austria','Azerbaijan',
  'Bahrain','Bangladesh','Belarus','Belgium','Bolivia','Bosnia and Herzegovina','Brazil','Bulgaria',
  'Cambodia','Cameroon','Canada','Chile','China','Colombia','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic',
  'Denmark','Dominican Republic','Ecuador','Egypt','El Salvador','Estonia','Ethiopia',
  'Finland','France','Georgia','Germany','Ghana','Greece','Guatemala','Honduras','Hungary',
  'Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy',
  'Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kuwait',
  'Latvia','Lebanon','Lithuania','Luxembourg','Malaysia','Mexico','Moldova','Morocco','Myanmar',
  'Nepal','Netherlands','New Zealand','Nigeria','North Macedonia','Norway',
  'Pakistan','Panama','Paraguay','Peru','Philippines','Poland','Portugal','Qatar',
  'Romania','Russia','Saudi Arabia','Serbia','Singapore','Slovakia','Slovenia',
  'South Africa','South Korea','Spain','Sri Lanka','Sweden','Switzerland',
  'Taiwan','Thailand','Tunisia','Turkey','Ukraine','United Arab Emirates',
  'United Kingdom','United States','Uruguay','Uzbekistan','Venezuela','Vietnam',
  'Yemen','Zimbabwe',
];

const TIER_PILLS = [
  { label: 'Nano',        sub: '< 10K',       value: 5000   },
  { label: 'Micro',       sub: '10K – 50K',   value: 25000  },
  { label: 'Influencer',  sub: '50K – 500K',  value: 150000 },
  { label: 'Celebrity',   sub: '500K+',       value: 750000 },
];

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const parseRow = (line) => {
    const cols = []; let current = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    cols.push(current.trim());
    return cols;
  };
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseRow(line);
    const get = (key) => values[headers.indexOf(key)]?.trim() || '';
    return {
      name:      get('name'),
      handle:    get('handle'),
      followers: parseInt(get('followers')) || 0,
      country:   get('country'),
      email:     get('email') || null,
    };
  }).filter(inf => inf.name && inf.handle);
}

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewInfluencers');
  const influencers = await prisma.influencer.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { seedings: true } } },
  });
  return { influencers, role: portalUser.role };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'create') {
    requirePermission(portalUser.role, 'createInfluencer');
    const handle    = String(formData.get('handle')    || '').slice(0, 100).trim();
    const country   = String(formData.get('country')   || '').slice(0, 100).trim();
    const followers = Math.max(0, parseInt(formData.get('followers') || '0') || 0);
    if (!handle) return { error: 'Handle is required.' };
    const inf = await prisma.influencer.create({
      data: { handle, name: handle.replace(/^@/, ''), followers, country },
    });
    await audit({ shop, portalUser, action: 'created_influencer', entityType: 'influencer', entityId: inf.id, detail: `Created ${handle}` });
    return { created: true };
  }

  if (intent === 'importCSV') {
    requirePermission(portalUser.role, 'createInfluencer');
    const file = formData.get('csvFile');
    if (!file || typeof file === 'string') return { error: 'No file uploaded.' };
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) return { error: 'No valid rows found. Check CSV has name and handle columns.' };
    await prisma.influencer.createMany({ data: rows, skipDuplicates: true });
    await audit({ shop, portalUser, action: 'imported_influencers', entityType: 'influencer', detail: `Imported ${rows.length} influencers via CSV` });
    return { imported: rows.length };
  }

  if (intent === 'bulkArchive') {
    requirePermission(portalUser.role, 'editInfluencer');
    const ids = formData.getAll('ids').map(Number);
    await prisma.influencer.updateMany({ where: { id: { in: ids } }, data: { archived: true } });
    await audit({ shop, portalUser, action: 'bulk_archived', entityType: 'influencer', detail: `Archived ${ids.length} influencers` });
    return { bulkDone: ids.length };
  }

  if (intent === 'bulkUnarchive') {
    requirePermission(portalUser.role, 'editInfluencer');
    const ids = formData.getAll('ids').map(Number);
    await prisma.influencer.updateMany({ where: { id: { in: ids } }, data: { archived: false } });
    await audit({ shop, portalUser, action: 'bulk_unarchived', entityType: 'influencer', detail: `Unarchived ${ids.length} influencers` });
    return { bulkDone: ids.length };
  }

  return null;
}

const CSV_TEMPLATE = `name,handle,followers,country,email\nSofia García,@sofiagarcia,45200,Spain,sofia@example.com\nMarco Rossi,@marcorossi,120000,Italy,marco@example.com`;
function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = 'influencers_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalInfluencers() {
  const { influencers, role } = useLoaderData();
  const actionData  = useActionData();
  const navigation  = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  const canCreate = can.createInfluencer(role);
  const canEdit   = can.editInfluencer(role);

  const [viewFilter, setViewFilter] = useState('active');
  const [tierFilter, setTierFilter] = useState('all');
  const [q,          setQ]          = useState('');
  const [showForm,   setShowForm]   = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected,   setSelected]   = useState(new Set());
  const [tierPick,   setTierPick]   = useState(null);

  // Close form on success
  if (actionData?.created && showForm)  { setShowForm(false);   setTierPick(null); }
  if (actionData?.imported && showImport) { setShowImport(false); }

  const TIERS = [
    { key: 'all',   label: 'All',           emoji: '' },
    { key: 'micro', label: 'Micro',         emoji: '🌱', sub: '0 – 50K'    },
    { key: 'mid',   label: 'Influencer',    emoji: '⭐', sub: '50K – 500K' },
    { key: 'celeb', label: 'Celebrity',     emoji: '🏆', sub: '500K+'      },
  ];

  const tierMatch = (inf) => {
    const f = inf.followers || 0;
    if (tierFilter === 'micro') return f < 50000;
    if (tierFilter === 'mid')   return f >= 50000 && f < 500000;
    if (tierFilter === 'celeb') return f >= 500000;
    return true;
  };

  const activeCount   = influencers.filter(i => !i.archived).length;
  const archivedCount = influencers.filter(i =>  i.archived).length;

  const filtered = influencers.filter(inf => {
    if (viewFilter === 'archived' ? !inf.archived : inf.archived) return false;
    if (!tierMatch(inf)) return false;
    if (q && !inf.name?.toLowerCase().includes(q.toLowerCase()) &&
             !inf.handle?.toLowerCase().includes(q.toLowerCase()) &&
             !inf.country?.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const allSelected    = filtered.length > 0 && filtered.every(i => selected.has(i.id));
  const someSelected   = filtered.some(i => selected.has(i.id));
  const selectedInView = filtered.filter(i => selected.has(i.id)).map(i => i.id);
  const toggleOne = (id) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map(i => i.id)));
  const clearSel  = () => setSelected(new Set());

  const btnBase  = { padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: D.textSub };
  const inputSt  = { padding: '8px 12px', border: `1px solid ${D.border}`, borderRadius: '7px', fontSize: '13px', backgroundColor: D.surface, color: D.text, width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>Influencers</h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: D.textSub }}>{filtered.length} shown</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && (
            <button onClick={() => { setShowImport(v => !v); setShowForm(false); }}
              style={{ ...btnBase, backgroundColor: showImport ? D.accentLight : 'transparent', color: showImport ? D.accent : D.textSub, borderColor: showImport ? D.accent : D.border }}>
              {showImport ? 'Cancel' : '↑ Import CSV'}
            </button>
          )}
          {canCreate && (
            <button onClick={() => { setShowForm(v => !v); setShowImport(false); setTierPick(null); }}
              style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: 'none', background: showForm ? D.surfaceHigh : 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)', color: showForm ? D.textSub : '#fff', boxShadow: showForm ? 'none' : '0 2px 6px rgba(124,111,247,0.35)' }}>
              {showForm ? 'Cancel' : '+ Add Influencer'}
            </button>
          )}
        </div>
      </div>

      {/* ── Banners ─────────────────────────────────────────────── */}
      {actionData?.imported && (
        <div style={{ padding: '12px 16px', backgroundColor: D.successBg, color: D.successText, borderRadius: '8px', fontWeight: '600', fontSize: '13px' }}>
          ✓ Successfully imported {actionData.imported} influencer{actionData.imported !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.bulkDone != null && (
        <div style={{ padding: '12px 16px', backgroundColor: D.successBg, color: D.successText, borderRadius: '8px', fontWeight: '600', fontSize: '13px' }}>
          ✓ Updated {actionData.bulkDone} influencer{actionData.bulkDone !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.error && (
        <div style={{ padding: '12px 16px', backgroundColor: D.errorBg, color: D.errorText, borderRadius: '8px', fontWeight: '600', fontSize: '13px' }}>
          ✗ {actionData.error}
        </div>
      )}

      {/* ── CSV Import panel ──────────────────────────────────── */}
      {showImport && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderLeft: `3px solid ${D.accent}`, borderRadius: '8px', padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '14px', color: D.text, marginBottom: '3px' }}>Import from CSV</div>
              <div style={{ fontSize: '12px', color: D.textSub }}>Required columns: <code style={{ color: D.accent }}>name, handle</code> — Optional: <code style={{ color: D.textSub }}>followers, country, email</code></div>
            </div>
            <button type="button" onClick={downloadTemplate} style={{ ...btnBase }}>↓ Template</button>
          </div>
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="importCSV" />
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input type="file" name="csvFile" accept=".csv" required
                style={{ flex: 1, padding: '8px 12px', border: `1px solid ${D.border}`, fontSize: '13px', backgroundColor: D.bg, color: D.text, borderRadius: '7px', cursor: 'pointer' }} />
              <button type="submit" disabled={isSubmitting}
                style={{ padding: '8px 20px', borderRadius: '7px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: 'none', backgroundColor: D.accent, color: '#fff', whiteSpace: 'nowrap' }}>
                {isSubmitting ? 'Importing…' : 'Import'}
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* ── Add influencer form ───────────────────────────────── */}
      {showForm && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderLeft: `3px solid ${D.accent}`, borderRadius: '8px', padding: '20px 24px' }}>
          <div style={{ fontWeight: '800', fontSize: '14px', color: D.text, marginBottom: '16px' }}>New Influencer</div>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="followers" value={tierPick?.value ?? 0} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '16px' }}>
              {/* Handle */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textSub, marginBottom: '6px' }}>
                  Instagram Handle *
                </label>
                <input name="handle" required placeholder="@sofia_gs" style={inputSt} />
              </div>

              {/* Tier pills */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textSub, marginBottom: '6px' }}>Tier *</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {TIER_PILLS.map(t => {
                    const active = tierPick?.label === t.label;
                    return (
                      <button key={t.label} type="button" onClick={() => setTierPick(t)} style={{
                        padding: '5px 10px', borderRadius: '8px',
                        border: `1.5px solid ${active ? D.accent : D.border}`,
                        backgroundColor: active ? D.accentLight : 'transparent',
                        color: active ? D.accent : D.textSub,
                        fontSize: '12px', fontWeight: active ? '700' : '500', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3,
                      }}>
                        <span>{t.label}</span>
                        <span style={{ fontSize: '10px', opacity: 0.7 }}>{t.sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Country */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textSub, marginBottom: '6px' }}>
                  Country
                </label>
                <select name="country" style={{ ...inputSt }}>
                  <option value="">Select country…</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button type="submit" disabled={isSubmitting || !tierPick}
                style={{ padding: '9px 22px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: tierPick ? 'pointer' : 'not-allowed', border: 'none', backgroundColor: D.accent, color: '#fff', opacity: tierPick ? 1 : 0.4 }}>
                {isSubmitting ? 'Saving…' : 'Add Influencer'}
              </button>
              <span style={{ fontSize: '11px', color: D.textMuted }}>Name & email auto-fill when they complete their first checkout.</span>
            </div>
          </Form>
        </div>
      )}

      {/* ── Active / Archived tabs ────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0', borderBottom: `1px solid ${D.border}` }}>
        {[
          { key: 'active',   label: 'Active',   count: activeCount },
          { key: 'archived', label: 'Archived', count: archivedCount },
        ].map(tab => (
          <button key={tab.key} type="button" onClick={() => { setViewFilter(tab.key); clearSel(); setTierFilter('all'); }} style={{
            padding: '8px 16px', fontSize: '13px', fontWeight: '600', border: 'none', cursor: 'pointer',
            backgroundColor: 'transparent', color: viewFilter === tab.key ? D.accent : D.textSub,
            borderBottom: `2px solid ${viewFilter === tab.key ? D.accent : 'transparent'}`,
            marginBottom: '-1px',
          }}>
            {tab.label}
            <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: '700', backgroundColor: viewFilter === tab.key ? D.accent : D.surfaceHigh, color: viewFilter === tab.key ? '#fff' : D.textSub, borderRadius: '10px', padding: '1px 7px' }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Tier + search filters ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {TIERS.map(t => {
          const base  = influencers.filter(i => viewFilter === 'archived' ? i.archived : !i.archived);
          const count = t.key === 'all' ? base.length : base.filter(i => {
            const f = i.followers || 0;
            if (t.key === 'micro') return f < 50000;
            if (t.key === 'mid')   return f >= 50000 && f < 500000;
            if (t.key === 'celeb') return f >= 500000;
            return false;
          }).length;
          const active = tierFilter === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setTierFilter(t.key)} style={{
              padding: '5px 14px', borderRadius: '20px', cursor: 'pointer',
              border: `1.5px solid ${active ? D.accent : D.border}`,
              backgroundColor: active ? D.accentLight : 'transparent',
              color: active ? D.accent : D.textSub,
              fontSize: '12px', fontWeight: active ? '700' : '500',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}>
              {t.emoji && <span>{t.emoji}</span>}
              {t.label}
              {t.sub && <span style={{ fontSize: '10px', color: active ? D.accent : D.textMuted }}>{t.sub}</span>}
              <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: active ? D.accent : D.surfaceHigh, color: active ? '#fff' : D.textSub, borderRadius: '10px', padding: '1px 6px' }}>
                {count}
              </span>
            </button>
          );
        })}

        <input
          type="text" placeholder="Search name, handle, country…"
          value={q} onChange={e => setQ(e.target.value)}
          style={{ marginLeft: 'auto', padding: '6px 12px', border: `1px solid ${D.border}`, borderRadius: '7px', fontSize: '13px', width: '220px', backgroundColor: D.surface, color: D.text }}
        />
      </div>

      {/* ── Bulk action bar ───────────────────────────────────── */}
      {someSelected && canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', backgroundColor: D.accentLight, border: `1px solid ${D.accent}`, borderRadius: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: D.accent }}>{selectedInView.length} selected</span>
          <div style={{ flex: 1 }} />
          {viewFilter === 'active' ? (
            <Form method="post" style={{ display: 'inline' }} onSubmit={clearSel}>
              <input type="hidden" name="intent" value="bulkArchive" />
              {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" disabled={isSubmitting} style={{ ...btnBase, color: D.text }}>Archive selected</button>
            </Form>
          ) : (
            <Form method="post" style={{ display: 'inline' }} onSubmit={clearSel}>
              <input type="hidden" name="intent" value="bulkUnarchive" />
              {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" disabled={isSubmitting} style={{ ...btnBase, color: D.text }}>Unarchive selected</button>
            </Form>
          )}
          <button type="button" onClick={clearSel} style={{ ...btnBase }}>Clear</button>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: D.textMuted, border: `2px dashed ${D.border}`, borderRadius: '12px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '15px', color: D.textSub }}>
            {viewFilter === 'archived' ? 'No archived influencers.' : 'No influencers yet.'}
          </p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            {viewFilter === 'archived' ? 'Archive influencers from the Active tab.' : 'Add one manually or import a CSV.'}
          </p>
        </div>
      ) : (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {canEdit && (
                  <th style={{ padding: '10px 16px', width: '36px' }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', width: '15px', height: '15px', accentColor: D.accent }} />
                  </th>
                )}
                {['Handle', 'Name', 'Followers', 'Country', 'Email', 'Seedings'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
                <tr key={inf.id} style={{ borderTop: `1px solid ${D.borderLight}`, opacity: inf.archived ? 0.65 : 1 }}>
                  {canEdit && (
                    <td style={{ padding: '12px 16px' }}>
                      <input type="checkbox" checked={selected.has(inf.id)} onChange={() => toggleOne(inf.id)} style={{ cursor: 'pointer', width: '15px', height: '15px', accentColor: D.accent }} />
                    </td>
                  )}
                  <td style={{ padding: '12px 16px', fontWeight: '700' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, backgroundColor: D.accentLight, border: `1.5px solid ${D.accent}`, position: 'relative' }}>
                        <img
                          src={`https://unavatar.io/instagram/${inf.handle.replace(/^@/, '')}`}
                          alt=""
                          onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{ display: 'none', position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '800', color: D.accent }}>
                          {(inf.handle || '@').slice(1, 2).toUpperCase()}
                        </div>
                      </div>
                      <Link to={`/portal/influencers/${inf.id}`} style={{ color: D.accent, textDecoration: 'none', fontWeight: '700' }}>@{inf.handle.replace(/^@/, '')}</Link>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '600', color: D.text }}>{inf.name || <span style={{ color: D.textMuted }}>—</span>}</td>
                  <td style={{ padding: '12px 16px', color: D.textSub }}>{inf.followers ? fmtNum(inf.followers) : <span style={{ color: D.textMuted }}>—</span>}</td>
                  <td style={{ padding: '12px 16px', color: D.textSub }}>{inf.country || <span style={{ color: D.textMuted }}>—</span>}</td>
                  <td style={{ padding: '12px 16px', color: D.textSub, fontSize: '12px' }}>
                    {inf.email
                      ? <a href={`mailto:${inf.email}`} style={{ color: D.accent, textDecoration: 'none' }}>{inf.email}</a>
                      : <span style={{ color: D.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-block', backgroundColor: inf._count.seedings > 0 ? D.accentLight : D.surfaceHigh, color: inf._count.seedings > 0 ? D.accent : D.textMuted, borderRadius: '6px', padding: '2px 10px', fontSize: '12px', fontWeight: '700' }}>
                      {inf._count.seedings}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
