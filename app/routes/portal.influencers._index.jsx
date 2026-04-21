import { useState, useCallback, useEffect } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, Link, useNavigate, useSearchParams } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtNum } from '../theme';
import { D, InstagramAvatar, FlagImg } from '../utils/portal-theme';
import { useT } from '../utils/i18n';

// ── Design tokens ─────────────────────────────────────────────────────────────

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

const PAGE_SIZE = 40;

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewInfluencers');

  const url      = new URL(request.url);
  const q        = url.searchParams.get('q')?.trim() || '';
  const view     = url.searchParams.get('view')  || 'active';   // active | archived
  const gender        = url.searchParams.get('gender')        || 'all';
  const followerRange = url.searchParams.get('followerRange') || 'all';
  const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1'));

  // Build where clause on the server — always scope to this shop
  const where = { shop, archived: view === 'archived' };
  if (q) {
    where.OR = [
      { handle:  { contains: q, mode: 'insensitive' } },
      { name:    { contains: q, mode: 'insensitive' } },
      { country: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (gender !== 'all') { where.gender = { equals: gender, mode: 'insensitive' }; }
  if (followerRange === 'lt10k')    { where.followers = { lt: 10000 }; }
  if (followerRange === '10to50k')  { where.followers = { gte: 10000, lt: 50000 }; }
  if (followerRange === '50to100k') { where.followers = { gte: 50000, lt: 100000 }; }
  if (followerRange === 'gt100k')   { where.followers = { gte: 100000 }; }

  const [influencers, total, activeCount, archivedCount] = await Promise.all([
    prisma.influencer.findMany({
      where,
      orderBy: { name: 'asc' },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
      select: {
        id: true, handle: true, name: true, followers: true,
        gender: true, country: true, email: true, archived: true,
        _count: { select: { seedings: true } },
      },
    }),
    prisma.influencer.count({ where }),
    prisma.influencer.count({ where: { shop, archived: false } }),
    prisma.influencer.count({ where: { shop, archived: true  } }),
  ]);

  return { influencers, total, page, activeCount, archivedCount, q, view, gender, followerRange, role: portalUser.role };
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
    const genderRaw = String(formData.get('gender') || '').trim();
    const gender    = ['Male', 'Female'].includes(genderRaw) ? genderRaw : null;
    if (!handle) return { error: 'Handle is required.' };
    const inf = await prisma.influencer.create({
      data: { shop, handle, name: handle.replace(/^@/, ''), followers, country, gender },
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
    await prisma.influencer.createMany({ data: rows.map(r => ({ ...r, shop })), skipDuplicates: true });
    await audit({ shop, portalUser, action: 'imported_influencers', entityType: 'influencer', detail: `Imported ${rows.length} influencers via CSV` });
    return { imported: rows.length };
  }

  if (intent === 'bulkArchive') {
    requirePermission(portalUser.role, 'editInfluencer');
    const ids = formData.getAll('ids').map(Number);
    await prisma.influencer.updateMany({ where: { shop, id: { in: ids } }, data: { archived: true } });
    await audit({ shop, portalUser, action: 'bulk_archived', entityType: 'influencer', detail: `Archived ${ids.length} influencers` });
    return { bulkDone: ids.length };
  }

  if (intent === 'bulkUnarchive') {
    requirePermission(portalUser.role, 'editInfluencer');
    const ids = formData.getAll('ids').map(Number);
    await prisma.influencer.updateMany({ where: { shop, id: { in: ids } }, data: { archived: false } });
    await audit({ shop, portalUser, action: 'bulk_unarchived', entityType: 'influencer', detail: `Unarchived ${ids.length} influencers` });
    return { bulkDone: ids.length };
  }

  if (intent === 'bulkDelete') {
    requirePermission(portalUser.role, 'editInfluencer');
    const ids = formData.getAll('ids').map(Number);
    // Cascade: delete child records first
    const seedingIds = (await prisma.seeding.findMany({ where: { shop, influencerId: { in: ids } }, select: { id: true } })).map(s => s.id);
    if (seedingIds.length > 0) {
      await prisma.seedingProduct.deleteMany({ where: { seedingId: { in: seedingIds } } });
      await prisma.seeding.deleteMany({ where: { id: { in: seedingIds } } });
    }
    await prisma.influencerSavedSize.deleteMany({ where: { influencerId: { in: ids } } });
    await prisma.influencer.deleteMany({ where: { shop, id: { in: ids } } });
    await audit({ shop, portalUser, action: 'bulk_deleted', entityType: 'influencer', detail: `Permanently deleted ${ids.length} influencer(s)` });
    return { bulkDeleted: ids.length };
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
  const { influencers, total, page, activeCount, archivedCount, q: initQ, view, gender, followerRange, role } = useLoaderData();
  const actionData   = useActionData();
  const navigation   = useNavigation();
  const navigate     = useNavigate();
  const { t }        = useT();
  const [searchParams] = useSearchParams();
  const isSubmitting  = navigation.state === 'submitting';

  const canCreate = can.createInfluencer(role);
  const canEdit   = can.editInfluencer(role);

  const [showForm,     setShowForm]     = useState(false);
  const [showImport,   setShowImport]   = useState(false);
  const [selected,     setSelected]     = useState(new Set());
  const [tierPick,     setTierPick]     = useState(null);
  const [newGender,    setNewGender]    = useState('');
  const [localQ,       setLocalQ]       = useState(initQ);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Close forms / reset state after successful actions
  useEffect(() => {
    if (actionData?.created)              { setShowForm(false); setTierPick(null); setNewGender(''); }
    if (actionData?.imported)             { setShowImport(false); }
    if (actionData?.bulkDeleted != null)  { setSelected(new Set()); setConfirmDelete(false); }
  }, [actionData]);

  const totalPages = Math.ceil(total / 40);

  const FOLLOWER_RANGES = [
    { key: 'all',      label: 'All sizes' },
    { key: 'lt10k',    label: '<10K' },
    { key: '10to50k',  label: '10–50K' },
    { key: '50to100k', label: '50–100K' },
    { key: 'gt100k',   label: '100K+' },
  ];
  const GENDERS = [
    { key: 'all',    label: 'Any' },
    { key: 'Male',   label: 'Male' },
    { key: 'Female', label: 'Female' },
  ];

  // Navigate with updated search params
  const setParam = useCallback((key, value) => {
    const p = new URLSearchParams(searchParams);
    if (value && value !== 'all' && value !== 'active' && value !== '') p.set(key, value);
    else p.delete(key);
    if (key !== 'page') p.delete('page'); // reset page on filter change
    navigate(`?${p.toString()}`, { replace: true });
  }, [searchParams, navigate]);

  // Debounced search — navigate after 350ms pause
  const handleSearch = useCallback((val) => {
    setLocalQ(val);
    clearTimeout(window._searchTimer);
    window._searchTimer = setTimeout(() => setParam('q', val), 350);
  }, [setParam]);

  const filtered      = influencers; // server already filtered
  const allSelected   = filtered.length > 0 && filtered.every(i => selected.has(i.id));
  const selectedInView= filtered.filter(i => selected.has(i.id)).map(i => i.id);
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
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>{t('influencers.title')}</h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: D.textSub }}>{total} total · {influencers.length} on this page</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && (
            <button onClick={() => { setShowImport(v => !v); setShowForm(false); }}
              style={{ ...btnBase, backgroundColor: showImport ? D.accentLight : 'transparent', color: showImport ? D.accent : D.textSub, borderColor: showImport ? D.accent : D.border }}>
              {showImport ? t('common.cancel') : t('influencers.importCSV')}
            </button>
          )}
          {canCreate && (
            <button onClick={() => { setShowForm(v => !v); setShowImport(false); setTierPick(null); }}
              style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: 'none', background: showForm ? D.surfaceHigh : `linear-gradient(135deg, ${D.accent} 0%, ${D.purple} 100%)`, color: showForm ? D.textSub : '#fff', boxShadow: showForm ? 'none' : '0 2px 6px rgba(124,111,247,0.35)' }}>
              {showForm ? t('common.cancel') : t('influencers.addInfluencer')}
            </button>
          )}
        </div>
      </div>

      {/* ── Banners ─────────────────────────────────────────────── */}
      {actionData?.imported && (
        <div style={{ padding: '12px 16px', backgroundColor: D.accentLight, color: D.accent, border: `1px solid ${D.accent}`, borderRadius: '8px', fontWeight: '600', fontSize: '13px' }}>
          ✓ Successfully imported {actionData.imported} influencer{actionData.imported !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.bulkDone != null && (
        <div style={{ padding: '12px 16px', backgroundColor: D.accentLight, color: D.accent, borderRadius: '8px', fontWeight: '600', fontSize: '13px', border: `1px solid ${D.accent}` }}>
          ✓ Updated {actionData.bulkDone} influencer{actionData.bulkDone !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.bulkDeleted != null && (
        <div style={{ padding: '12px 16px', backgroundColor: D.errorBg, color: D.errorText, borderRadius: '8px', fontWeight: '600', fontSize: '13px', border: `1px solid ${D.errorText}` }}>
          ✓ Permanently deleted {actionData.bulkDeleted} influencer{actionData.bulkDeleted !== 1 ? 's' : ''}.
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', marginBottom: '16px' }}>
              {/* Handle */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textSub, marginBottom: '6px' }}>
                  Instagram Handle *
                </label>
                <input name="handle" required placeholder="@sofia_gs" style={inputSt} />
              </div>

              {/* Gender */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textSub, marginBottom: '6px' }}>Gender</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['Male', 'Female'].map(g => {
                    const active = newGender === g;
                    return (
                      <button key={g} type="button" onClick={() => setNewGender(active ? '' : g)} style={{
                        padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                        border: `1.5px solid ${active ? D.accent : D.border}`,
                        backgroundColor: active ? D.accentLight : 'transparent',
                        color: active ? D.accent : D.textSub,
                        fontSize: '12px', fontWeight: active ? '700' : '500',
                      }}>
                        {g}
                      </button>
                    );
                  })}
                </div>
                <input type="hidden" name="gender" value={newGender} />
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
          <button key={tab.key} type="button" onClick={() => { setParam('view', tab.key); clearSel(); }} style={{
            padding: '8px 16px', fontSize: '13px', fontWeight: '600', border: 'none', cursor: 'pointer',
            backgroundColor: 'transparent', color: view === tab.key ? D.accent : D.textSub,
            borderBottom: `2px solid ${view === tab.key ? D.accent : 'transparent'}`,
            marginBottom: '-1px',
          }}>
            {tab.label}
            <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: '700', backgroundColor: view === tab.key ? D.accent : D.surfaceHigh, color: view === tab.key ? '#0D0F14' : D.textSub, borderRadius: '10px', padding: '1px 7px' }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {GENDERS.map(g => {
            const active = gender === g.key;
            return (
              <button key={g.key} type="button" onClick={() => setParam('gender', g.key)} style={{
                padding: '5px 13px', borderRadius: '20px', cursor: 'pointer',
                border: `1.5px solid ${active ? D.accent : D.border}`,
                backgroundColor: active ? D.accentLight : 'transparent',
                color: active ? D.accent : D.textSub,
                fontSize: '12px', fontWeight: active ? '700' : '500',
              }}>
                {g.label}
              </button>
            );
          })}
          <div style={{ width: '1px', height: '16px', backgroundColor: D.border, margin: '0 2px' }} />
          {FOLLOWER_RANGES.map(r => {
            const active = followerRange === r.key;
            return (
              <button key={r.key} type="button" onClick={() => setParam('followerRange', r.key)} style={{
                padding: '5px 13px', borderRadius: '20px', cursor: 'pointer',
                border: `1.5px solid ${active ? D.accent : D.border}`,
                backgroundColor: active ? D.accentLight : 'transparent',
                color: active ? D.accent : D.textSub,
                fontSize: '12px', fontWeight: active ? '700' : '500',
              }}>
                {r.label}
              </button>
            );
          })}
          <input
            type="text" placeholder="Search name, handle, country…"
            value={localQ} onChange={e => handleSearch(e.target.value)}
            style={{ marginLeft: 'auto', padding: '6px 12px', border: `1px solid ${D.border}`, borderRadius: '7px', fontSize: '13px', width: '220px', backgroundColor: D.surface, color: D.text }}
          />
        </div>
      </div>

      {/* ── Bulk action bar ───────────────────────────────────── */}
      {selectedInView.length > 0 && canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', backgroundColor: D.accentLight, border: `1px solid ${D.accent}`, borderRadius: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: D.accent }}>{selectedInView.length} selected</span>
          <div style={{ flex: 1 }} />

          {/* Archive / Unarchive */}
          {view !== 'archived' ? (
            <Form method="post" style={{ display: 'inline' }} onSubmit={clearSel}>
              <input type="hidden" name="intent" value="bulkArchive" />
              {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" disabled={isSubmitting} style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${D.border}`, backgroundColor: D.surfaceHigh, color: D.text }}>Archive selected</button>
            </Form>
          ) : (
            <Form method="post" style={{ display: 'inline' }} onSubmit={clearSel}>
              <input type="hidden" name="intent" value="bulkUnarchive" />
              {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" disabled={isSubmitting} style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${D.border}`, backgroundColor: D.surfaceHigh, color: D.text }}>Unarchive selected</button>
            </Form>
          )}

          {/* Delete — two-step confirmation */}
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)}
              style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', border: 'none', background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)', color: '#FFFFFF', boxShadow: '0 1px 3px rgba(220,38,38,0.25)' }}>
              Delete selected
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', backgroundColor: D.errorBg, border: `1px solid ${D.errorText}`, borderRadius: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: D.errorText }}>
                Permanently delete {selectedInView.length} influencer{selectedInView.length !== 1 ? 's' : ''}?
              </span>
              <Form method="post" style={{ display: 'inline' }}>
                <input type="hidden" name="intent" value="bulkDelete" />
                {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
                <button type="submit" disabled={isSubmitting}
                  style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: 'none', backgroundColor: D.errorText, color: '#fff' }}>
                  {isSubmitting ? 'Deleting…' : 'Yes, delete'}
                </button>
              </Form>
              <button type="button" onClick={() => setConfirmDelete(false)}
                style={{ ...btnBase, padding: '5px 10px', fontSize: '11px' }}>Cancel</button>
            </div>
          )}

          <button type="button" onClick={() => { clearSel(); setConfirmDelete(false); }} style={{ ...btnBase }}>Clear</button>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────── */}
      {influencers.length === 0 ? (
        view === 'archived' ? (
          <div style={{ textAlign: 'center', padding: '60px', color: D.textMuted, border: `2px dashed ${D.border}`, borderRadius: '12px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '15px', color: D.textSub }}>{t('influencers.empty.noArchived')}</p>
            <p style={{ margin: 0, fontSize: '13px' }}>{t('influencers.empty.archiveFrom')}</p>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '56px 32px', border: `2px dashed ${D.border}`, borderRadius: '14px' }}>
            <div style={{ marginBottom: '14px', color: D.textMuted, display: 'flex', justifyContent: 'center' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: D.text, marginBottom: '6px' }}>
              No influencers yet
            </div>
            <div style={{ fontSize: '13px', color: D.textMuted, marginBottom: '20px', lineHeight: 1.5 }}>
              Add influencers manually or import a CSV to get started.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setShowForm(true)}
                style={{ padding: '9px 20px', fontSize: '13px', fontWeight: '700', borderRadius: '9px',
                  background: `linear-gradient(135deg, ${D.accent} 0%, ${D.purple} 100%)`,
                  color: '#fff', border: 'none', cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(124,111,247,0.28)' }}>
                + Add your first influencer
              </button>
              <button type="button" onClick={() => setShowImport(true)}
                style={{ padding: '9px 20px', fontSize: '13px', fontWeight: '600', borderRadius: '9px',
                  border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: D.textSub, cursor: 'pointer' }}>
                Import CSV
              </button>
            </div>
          </div>
        )
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
                {[t('influencers.table.handle'), t('influencers.table.name'), t('influencers.table.followers'), t('influencers.table.country'), t('influencers.table.email'), t('influencers.table.seedings')].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {influencers.map(inf => (
                <tr key={inf.id} style={{ borderTop: `1px solid ${D.borderLight}`, opacity: inf.archived ? 0.65 : 1 }}>
                  {canEdit && (
                    <td style={{ padding: '12px 16px' }}>
                      <input type="checkbox" checked={selected.has(inf.id)} onChange={() => toggleOne(inf.id)} style={{ cursor: 'pointer', width: '15px', height: '15px', accentColor: D.accent }} />
                    </td>
                  )}
                  <td style={{ padding: '12px 16px', fontWeight: '700' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <InstagramAvatar handle={inf.handle} size={32} />
                      <Link to={`/portal/influencers/${inf.id}`} style={{ color: D.accent, textDecoration: 'none', fontWeight: '700' }}>@{inf.handle.replace(/^@/, '')}</Link>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '600', color: D.text }}>{inf.name || <span style={{ color: D.textMuted }}>—</span>}</td>
                  <td style={{ padding: '12px 16px', color: D.textSub }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {inf.followers ? fmtNum(inf.followers) : <span style={{ color: D.textMuted }}>—</span>}
                      {inf.gender && (
                        <span style={{
                          fontSize: '10px', fontWeight: '700', lineHeight: 1,
                          color: inf.gender.toLowerCase() === 'female' ? '#EC4899'
                               : inf.gender.toLowerCase() === 'male'   ? '#3B82F6'
                               : D.textMuted,
                        }}>
                          {inf.gender}
                        </span>
                      )}
                    </div>
                  </td>
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

      {/* ── Pagination ────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}>
          <button
            type="button" disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
            style={{ padding: '6px 14px', borderRadius: '7px', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: page <= 1 ? D.textMuted : D.textSub, cursor: page <= 1 ? 'default' : 'pointer', fontSize: '13px', fontWeight: '600' }}
          >← Prev</button>
          <span style={{ fontSize: '13px', color: D.textSub, padding: '0 8px' }}>
            Page {page} of {totalPages} · {total} total
          </span>
          <button
            type="button" disabled={page >= totalPages}
            onClick={() => setParam('page', String(page + 1))}
            style={{ padding: '6px 14px', borderRadius: '7px', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: page >= totalPages ? D.textMuted : D.textSub, cursor: page >= totalPages ? 'default' : 'pointer', fontSize: '13px', fontWeight: '600' }}
          >Next →</button>
        </div>
      )}
    </div>
  );
}
