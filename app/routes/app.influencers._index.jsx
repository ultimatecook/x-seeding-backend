import { useState, useEffect, useRef } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, useRouteError, Link } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, input, card, label as lbl, section, fmtNum } from '../theme';

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Argentina','Armenia','Australia','Austria','Azerbaijan',
  'Bahrain','Bangladesh','Belarus','Belgium','Bolivia','Bosnia and Herzegovina','Brazil','Bulgaria',
  'Cambodia','Cameroon','Canada','Chile','China','Colombia','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic',
  'Denmark','Dominican Republic',
  'Ecuador','Egypt','El Salvador','Estonia','Ethiopia',
  'Finland','France',
  'Georgia','Germany','Ghana','Greece','Guatemala',
  'Honduras','Hungary',
  'Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy',
  'Jamaica','Japan','Jordan',
  'Kazakhstan','Kenya','Kuwait',
  'Latvia','Lebanon','Lithuania','Luxembourg',
  'Malaysia','Mexico','Moldova','Morocco','Myanmar',
  'Nepal','Netherlands','New Zealand','Nigeria','North Macedonia','Norway',
  'Pakistan','Panama','Paraguay','Peru','Philippines','Poland','Portugal',
  'Qatar',
  'Romania','Russia',
  'Saudi Arabia','Serbia','Singapore','Slovakia','Slovenia','South Africa','South Korea','Spain','Sri Lanka','Sweden','Switzerland',
  'Taiwan','Thailand','Tunisia','Turkey',
  'Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan',
  'Venezuela','Vietnam',
  'Yemen',
  'Zimbabwe',
];

export async function loader() {
  const influencers = await prisma.influencer.findMany({ orderBy: { name: 'asc' } });
  return { influencers };
}

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
    return { name: get('name'), handle: get('handle'), followers: parseInt(get('followers')) || 0, country: get('country'), email: get('email') || null };
  }).filter(inf => inf.name && inf.handle);
}

export async function action({ request }) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'create') {
    const handle  = String(formData.get('handle')  || '').slice(0, 100).trim();
    const country = String(formData.get('country') || '').slice(0, 100).trim();
    if (!handle) return { error: 'Handle is required.' };
    await prisma.influencer.create({
      data: {
        handle,
        name:      handle.replace(/^@/, ''), // placeholder — overwritten by Shopify checkout
        followers: Math.max(0, parseInt(formData.get('followers') || '0') || 0),
        country,
      },
    });
    return null;
  }

  if (intent === 'delete') {
    const id = parseInt(formData.get('id'));
    const seedingCount = await prisma.seeding.count({ where: { influencerId: id } });
    if (seedingCount > 0) {
      return { error: `Can't delete — this influencer has ${seedingCount} seeding${seedingCount !== 1 ? 's' : ''}. Archive them instead.` };
    }
    await prisma.influencer.delete({ where: { id } });
    return null;
  }

  if (intent === 'updateNotes') {
    const notes = formData.get('notes') ? String(formData.get('notes')).slice(0, 1000) : null;
    await prisma.influencer.update({
      where: { id: parseInt(formData.get('id')) },
      data:  { notes },
    });
    return null;
  }

  if (intent === 'bulkArchive') {
    const ids = formData.getAll('ids').map(Number);
    await prisma.influencer.updateMany({ where: { id: { in: ids } }, data: { archived: true } });
    return { bulkDone: ids.length };
  }

  if (intent === 'bulkUnarchive') {
    const ids = formData.getAll('ids').map(Number);
    await prisma.influencer.updateMany({ where: { id: { in: ids } }, data: { archived: false } });
    return { bulkDone: ids.length };
  }

  if (intent === 'bulkDelete') {
    const ids = formData.getAll('ids').map(Number);
    await prisma.influencer.deleteMany({ where: { id: { in: ids } } });
    return { bulkDone: ids.length };
  }

  if (intent === 'importCSV') {
    const file = formData.get('csvFile');
    if (!file || typeof file === 'string') return { error: 'No file uploaded.' };
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) return { error: 'No valid rows found. Check the CSV format.' };
    await prisma.influencer.createMany({ data: rows, skipDuplicates: true });
    return { imported: rows.length };
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

export default function Influencers() {
  const { influencers } = useLoaderData();
  const actionData      = useActionData();
  const navigation      = useNavigation();
  const isSubmitting    = navigation.state === 'submitting';

  const [showForm, setShowForm]       = useState(false);
  const [showImport, setShowImport]   = useState(false);
  const [tierFilter, setTierFilter]   = useState('all');
  const [viewFilter, setViewFilter]   = useState('active'); // 'active' | 'archived'
  const [selected, setSelected]       = useState(new Set());
  const [editNotesId, setEditNotesId] = useState(null);
  const [notesDraft, setNotesDraft]   = useState('');

  // Instagram auto-fill state
  const [igHandle,    setIgHandle]    = useState('');
  const [igLookup,    setIgLookup]    = useState(null);   // { username, fullName, followers, profilePic }
  const [igLoading,   setIgLoading]   = useState(false);
  const [igError,     setIgError]     = useState(null);
  const debounceRef = useRef(null);

  // Debounced lookup: fires 600ms after the user stops typing
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const handle = igHandle.replace(/^@/, '').trim();
    if (handle.length < 2) { setIgLookup(null); setIgError(null); return; }
    setIgLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/instagram-search?q=${encodeURIComponent(handle)}`);
        const data = await res.json();
        const match = (data.users || []).find(u => u.username.toLowerCase() === handle.toLowerCase())
                   || data.users?.[0];
        if (data.rateLimited) {
          // Instagram is rate-limiting — silently skip, let user fill manually
          setIgLookup(null);
          setIgError('Instagram lookup unavailable — fill in manually');
        } else if (data.users?.length > 0) {
          setIgLookup(data.users[0]);
          setIgError(null);
        } else {
          setIgLookup(null);
          setIgError(null); // handle exists but nothing found — don't block
        }
      } catch {
        setIgLookup(null);
        setIgError(null); // network error — fail silently
      } finally {
        setIgLoading(false);
      }
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [igHandle]);

  const inputSt = { ...input.base };

  const TIERS = [
    { key: 'all',   label: 'All' },
    { key: 'micro', label: '🌱 Micro',      sub: '0 – 50K' },
    { key: 'mid',   label: '⭐ Influencer',  sub: '50K – 500K' },
    { key: 'celeb', label: '🏆 Celebrity',   sub: '500K+' },
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

  const filtered = influencers.filter(inf =>
    (viewFilter === 'archived' ? inf.archived : !inf.archived) && tierMatch(inf)
  );

  const allSelected    = filtered.length > 0 && filtered.every(i => selected.has(i.id));
  const someSelected   = filtered.some(i => selected.has(i.id));
  const selectedInView = filtered.filter(i => selected.has(i.id)).map(i => i.id);

  const toggleOne  = (id) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll  = () => setSelected(allSelected ? new Set() : new Set(filtered.map(i => i.id)));
  const clearSel   = () => setSelected(new Set());

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: C.text }}>
          Influencers <span style={{ fontSize: '14px', fontWeight: '400', color: C.textMuted }}>({filtered.length})</span>
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setShowImport(v => !v); setShowForm(false); }}
            style={{ ...btn.ghost, backgroundColor: showImport ? C.accentFaint : 'transparent', color: showImport ? C.accent : C.textSub, borderColor: showImport ? C.accent : C.border }}>
            {showImport ? 'Cancel' : '↑ Import CSV'}
          </button>
          <button onClick={() => { setShowForm(v => !v); setShowImport(false); }}
            style={{ ...btn.primary, backgroundColor: showForm ? 'transparent' : C.accent, color: showForm ? C.textSub : '#fff', border: showForm ? `1px solid ${C.border}` : 'none' }}>
            {showForm ? 'Cancel' : '+ Add Influencer'}
          </button>
        </div>
      </div>

      {/* Active / Archived tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: `1px solid ${C.border}`, paddingBottom: '0' }}>
        {[
          { key: 'active',   label: 'Active',   count: activeCount },
          { key: 'archived', label: 'Archived', count: archivedCount },
        ].map(tab => (
          <button key={tab.key} type="button" onClick={() => { setViewFilter(tab.key); clearSel(); }}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: '600', border: 'none', cursor: 'pointer',
              backgroundColor: 'transparent', color: viewFilter === tab.key ? C.accent : C.textSub,
              borderBottom: `2px solid ${viewFilter === tab.key ? C.accent : 'transparent'}`,
              marginBottom: '-1px', transition: 'all 0.15s',
            }}>
            {tab.label}
            <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: '700', backgroundColor: viewFilter === tab.key ? C.accent : C.borderLight, color: viewFilter === tab.key ? '#fff' : C.textSub, borderRadius: '10px', padding: '1px 7px' }}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Tier filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
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
              padding: '6px 14px', borderRadius: '20px', border: `1.5px solid ${active ? C.accent : C.border}`,
              backgroundColor: active ? C.accentFaint : 'transparent',
              color: active ? C.accent : C.textSub,
              fontSize: '12px', fontWeight: active ? '700' : '500', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              {t.label}
              {t.sub && <span style={{ fontSize: '10px', color: active ? C.accent : C.textMuted }}>{t.sub}</span>}
              <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: active ? C.accent : C.borderLight, color: active ? '#fff' : C.textSub, borderRadius: '10px', padding: '1px 6px' }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Banners */}
      {actionData?.imported && (
        <div style={{ padding: '12px 16px', backgroundColor: C.successBg, color: C.successText, borderRadius: '6px', marginBottom: '16px', fontWeight: '600', fontSize: '13px' }}>
          ✓ Successfully imported {actionData.imported} influencer{actionData.imported !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.bulkDone && (
        <div style={{ padding: '12px 16px', backgroundColor: C.successBg, color: C.successText, borderRadius: '6px', marginBottom: '16px', fontWeight: '600', fontSize: '13px' }}>
          ✓ Updated {actionData.bulkDone} influencer{actionData.bulkDone !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.error && (
        <div style={{ padding: '12px 16px', backgroundColor: C.errorBg, color: C.errorText, borderRadius: '6px', marginBottom: '16px', fontWeight: '600', fontSize: '13px' }}>
          ✗ {actionData.error}
        </div>
      )}

      {/* CSV Import panel */}
      {showImport && (
        <div style={{ padding: '24px', backgroundColor: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '14px', marginBottom: '4px', color: C.text }}>Import from CSV</div>
              <div style={{ fontSize: '12px', color: C.textSub }}>Required: <code style={{ color: C.accent }}>name, handle</code> — Optional: <code style={{ color: C.textSub }}>followers, country, email</code></div>
            </div>
            <button type="button" onClick={downloadTemplate} style={{ ...btn.ghost }}>↓ Download Template</button>
          </div>
          <Form method="post" encType="multipart/form-data" onSubmit={() => setShowImport(false)}>
            <input type="hidden" name="intent" value="importCSV" />
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input type="file" name="csvFile" accept=".csv" required
                style={{ flex: 1, padding: '9px 12px', border: `1px solid ${C.border}`, fontSize: '13px', backgroundColor: C.overlay, color: C.text, borderRadius: '6px', cursor: 'pointer' }} />
              <button type="submit" disabled={isSubmitting} style={{ ...btn.primary, whiteSpace: 'nowrap' }}>
                {isSubmitting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Manual add form */}
      {showForm && (
        <Form method="post" onSubmit={() => { if (!isSubmitting) { setShowForm(false); setIgHandle(''); setIgLookup(null); } }}
          style={{ padding: '24px', backgroundColor: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: '8px', marginBottom: '24px' }}>
          <input type="hidden" name="intent" value="create" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', alignItems: 'end' }}>
            {/* Handle */}
            <label style={{ ...lbl.base }}>
              Instagram Handle *
              <div style={{ position: 'relative', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  name="handle" required placeholder="@sofia_gs" value={igHandle}
                  onChange={e => setIgHandle(e.target.value)}
                  style={{ ...inputSt, flex: 1 }}
                />
                {igLoading && <span style={{ fontSize: '12px', color: C.textMuted }}>⏳</span>}
                {igLookup && !igLoading && <span style={{ fontSize: '12px', color: '#16A34A', fontWeight: '700' }}>✓</span>}
              </div>
            </label>

            {/* Followers — pre-filled from IG if available, always editable */}
            <label style={{ ...lbl.base }}>
              Followers
              <input
                key={igLookup?.followers ?? 'manual'}
                name="followers"
                type="number"
                min="0"
                placeholder="e.g. 45000"
                defaultValue={igLookup?.followers || ''}
                style={{ ...inputSt, display: 'block', marginTop: '6px' }}
              />
              {igLookup?.followers && (
                <div style={{ fontSize: '11px', color: '#16A34A', marginTop: '3px', fontWeight: '600' }}>
                  ✓ auto-filled from Instagram
                </div>
              )}
            </label>

            {/* Country */}
            <label style={{ ...lbl.base }}>
              Country
              <select name="country" style={{ ...inputSt, display: 'block', marginTop: '6px' }}>
                <option value="">Select country…</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            {/* Submit */}
            <button type="submit" disabled={isSubmitting || !igHandle.trim()}
              style={{ ...btn.primary, padding: '10px 20px', fontSize: '14px', opacity: igHandle.trim() ? 1 : 0.4 }}>
              {isSubmitting ? 'Saving...' : 'Add'}
            </button>
          </div>

          <p style={{ margin: '12px 0 0', fontSize: '11px', color: C.textMuted }}>
            Name and email are fetched automatically when the influencer completes their first checkout.
          </p>
        </Form>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: C.accentFaint, border: `1px solid ${C.accent}`, borderRadius: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: C.accent }}>
            {selectedInView.length} selected
          </span>
          <div style={{ flex: 1 }} />
          {viewFilter === 'active' ? (
            <Form method="post" style={{ display: 'inline' }} onSubmit={clearSel}>
              <input type="hidden" name="intent" value="bulkArchive" />
              {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" disabled={isSubmitting} style={{ ...btn.secondary, fontSize: '12px', padding: '6px 14px' }}>
                Archive selected
              </button>
            </Form>
          ) : (
            <Form method="post" style={{ display: 'inline' }} onSubmit={clearSel}>
              <input type="hidden" name="intent" value="bulkUnarchive" />
              {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
              <button type="submit" disabled={isSubmitting} style={{ ...btn.secondary, fontSize: '12px', padding: '6px 14px' }}>
                Unarchive selected
              </button>
            </Form>
          )}
          <Form method="post" style={{ display: 'inline' }}
            onSubmit={e => { if (!confirm(`Delete ${selectedInView.length} influencer${selectedInView.length !== 1 ? 's' : ''}? This cannot be undone.`)) e.preventDefault(); else clearSel(); }}>
            <input type="hidden" name="intent" value="bulkDelete" />
            {selectedInView.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
            <button type="submit" disabled={isSubmitting} style={{ ...btn.secondary, fontSize: '12px', padding: '6px 14px', color: '#DC2626', borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }}>
              Delete selected
            </button>
          </Form>
          <button type="button" onClick={clearSel} style={{ ...btn.ghost, fontSize: '12px', padding: '6px 10px' }}>
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '16px', color: C.textSub }}>
            {viewFilter === 'archived' ? 'No archived influencers.' : 'No influencers yet.'}
          </p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            {viewFilter === 'archived' ? 'Archive influencers from the Active tab.' : 'Add one manually or import a CSV.'}
          </p>
        </div>
      ) : (
        <div style={{ ...card.flat, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '12px 12px', width: '36px' }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                </th>
                {['Handle', 'Name', 'Followers', 'Country', 'Email', 'Notes', ''].map(h => (
                  <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
                <tr key={inf.id} style={{ borderBottom: `1px solid ${C.borderLight}`, opacity: inf.archived ? 0.65 : 1 }}>
                  <td style={{ padding: '12px 12px' }}>
                    <input type="checkbox" checked={selected.has(inf.id)} onChange={() => toggleOne(inf.id)}
                      style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                  </td>
                  <td style={{ padding: '12px 12px', fontWeight: '700' }}>
                    <Link to={`/app/influencers/${inf.id}`} style={{ color: C.accent, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, backgroundColor: C.accentFaint, border: `1.5px solid ${C.accent}`, position: 'relative' }}>
                        <img
                          src={`https://unavatar.io/instagram/${inf.handle.replace(/^@/, '')}`}
                          alt=""
                          onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{ display: 'none', position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '800', color: C.accent }}>
                          {(inf.handle || '@').slice(1, 2).toUpperCase()}
                        </div>
                      </div>
                      {inf.handle}
                    </Link>
                  </td>
                  <td style={{ padding: '12px 12px', color: C.text }}>{inf.name}</td>
                  <td style={{ padding: '12px 12px', color: C.textSub }}>{fmtNum(inf.followers)}</td>
                  <td style={{ padding: '12px 12px', color: C.textSub }}>{inf.country}</td>
                  <td style={{ padding: '12px 12px', color: C.textMuted }}>{inf.email || '—'}</td>

                  {/* Notes cell — click to edit inline */}
                  <td style={{ padding: '8px 12px', maxWidth: '220px' }}>
                    {editNotesId === inf.id ? (
                      <Form method="post" onSubmit={() => setEditNotesId(null)}>
                        <input type="hidden" name="intent" value="updateNotes" />
                        <input type="hidden" name="id" value={inf.id} />
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <input
                            autoFocus
                            name="notes"
                            defaultValue={notesDraft}
                            placeholder="Add a note…"
                            onKeyDown={e => { if (e.key === 'Escape') setEditNotesId(null); }}
                            style={{ ...input.base, fontSize: '12px', padding: '4px 8px', flex: 1, minWidth: 0 }}
                          />
                          <button type="submit" disabled={isSubmitting} style={{ ...btn.primary, fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' }}>Save</button>
                          <button type="button" onClick={() => setEditNotesId(null)} style={{ ...btn.ghost, fontSize: '11px', padding: '4px 8px' }}>✕</button>
                        </div>
                      </Form>
                    ) : (
                      <button type="button"
                        onClick={() => { setEditNotesId(inf.id); setNotesDraft(inf.notes || ''); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 4px', borderRadius: '4px', width: '100%' }}>
                        {inf.notes ? (
                          <span style={{ fontSize: '12px', color: C.textSub, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inf.notes}
                          </span>
                        ) : (
                          <span style={{ fontSize: '12px', color: C.textMuted, fontStyle: 'italic' }}>+ add note</span>
                        )}
                      </button>
                    )}
                  </td>

                  <td style={{ padding: '12px 12px' }}>
                    <Form method="post" onSubmit={e => { if (!confirm(`Delete ${inf.handle}?`)) e.preventDefault(); }}>
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={inf.id} />
                      <button type="submit" style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                    </Form>
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
