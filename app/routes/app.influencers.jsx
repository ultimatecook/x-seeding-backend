import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, input, card, label as lbl, section } from '../theme';

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
    await prisma.influencer.create({
      data: { name: formData.get('name'), handle: formData.get('handle'), followers: parseInt(formData.get('followers') || '0'), country: formData.get('country'), email: formData.get('email') || null },
    });
    return null;
  }
  if (intent === 'delete') {
    await prisma.influencer.delete({ where: { id: parseInt(formData.get('id')) } });
    return null;
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
  const [showForm, setShowForm]     = useState(false);
  const [showImport, setShowImport] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  const inputSt = { ...input.base };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <h2 style={{ margin: 0, color: C.text }}>
          Influencers <span style={{ fontSize: '14px', fontWeight: '400', color: C.textMuted }}>({influencers.length})</span>
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

      {/* Banners */}
      {actionData?.imported && (
        <div style={{ padding: '12px 16px', backgroundColor: C.successBg, color: C.successText, borderRadius: '6px', marginBottom: '20px', fontWeight: '600', fontSize: '13px' }}>
          ✓ Successfully imported {actionData.imported} influencer{actionData.imported !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.error && (
        <div style={{ padding: '12px 16px', backgroundColor: C.errorBg, color: C.errorText, borderRadius: '6px', marginBottom: '20px', fontWeight: '600', fontSize: '13px' }}>
          ✗ {actionData.error}
        </div>
      )}

      {/* CSV Import panel */}
      {showImport && (
        <div style={{ padding: '24px', backgroundColor: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: '8px', marginBottom: '32px' }}>
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
        <Form method="post" onSubmit={() => { if (!isSubmitting) setShowForm(false); }}
          style={{ padding: '24px', backgroundColor: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: '8px', marginBottom: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <input type="hidden" name="intent" value="create" />
          {[
            { name: 'name',      label: 'Full Name *',        placeholder: 'Sofia García', required: true,  type: 'text'   },
            { name: 'handle',    label: 'Instagram Handle *', placeholder: '@sofía_gs',    required: true,  type: 'text'   },
            { name: 'followers', label: 'Followers',          placeholder: '45200',        required: false, type: 'number' },
            { name: 'country',   label: 'Country *',          placeholder: 'Spain',        required: true,  type: 'text'   },
          ].map(f => (
            <label key={f.name} style={{ ...lbl.base }}>
              {f.label}
              <input name={f.name} required={f.required} placeholder={f.placeholder} type={f.type}
                style={{ ...inputSt, display: 'block', marginTop: '6px' }} />
            </label>
          ))}
          <label style={{ ...lbl.base, gridColumn: '1 / -1' }}>
            Email
            <input name="email" type="email" placeholder="sofia@example.com"
              style={{ ...inputSt, display: 'block', marginTop: '6px' }} />
          </label>
          <button type="submit" disabled={isSubmitting}
            style={{ ...btn.primary, gridColumn: '1 / -1', padding: '12px', fontSize: '14px' }}>
            {isSubmitting ? 'Saving...' : 'Add Influencer'}
          </button>
        </Form>
      )}

      {/* Table */}
      {influencers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '16px', color: C.textSub }}>No influencers yet.</p>
          <p style={{ margin: 0, fontSize: '13px' }}>Add one manually or import a CSV.</p>
        </div>
      ) : (
        <div style={{ ...card.flat, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Handle', 'Name', 'Followers', 'Country', 'Email', ''].map(h => (
                  <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {influencers.map(inf => (
                <tr key={inf.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: '12px 12px', fontWeight: '700', color: C.accent }}>{inf.handle}</td>
                  <td style={{ padding: '12px 12px', color: C.text }}>{inf.name}</td>
                  <td style={{ padding: '12px 12px', color: C.textSub }}>{inf.followers?.toLocaleString()}</td>
                  <td style={{ padding: '12px 12px', color: C.textSub }}>{inf.country}</td>
                  <td style={{ padding: '12px 12px', color: C.textMuted }}>{inf.email || '—'}</td>
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
