import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';

export async function loader() {
  const influencers = await prisma.influencer.findMany({ orderBy: { name: 'asc' } });
  return { influencers };
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];

  const parseRow = (line) => {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current.trim());
    return cols;
  };

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));

  return lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      const values = parseRow(line);
      const get = (key) => values[headers.indexOf(key)]?.trim() || '';
      return {
        name:      get('name'),
        handle:    get('handle'),
        followers: parseInt(get('followers')) || 0,
        country:   get('country'),
        email:     get('email') || null,
      };
    })
    .filter(inf => inf.name && inf.handle);
}

export async function action({ request }) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'create') {
    await prisma.influencer.create({
      data: {
        name:      formData.get('name'),
        handle:    formData.get('handle'),
        followers: parseInt(formData.get('followers') || '0'),
        country:   formData.get('country'),
        email:     formData.get('email') || null,
      },
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

const inputStyle = {
  padding: '9px 10px',
  border: '1px solid #ddd',
  fontSize: '13px',
  width: '100%',
  boxSizing: 'border-box',
};

const CSV_TEMPLATE = `name,handle,followers,country,email
Sofia García,@sofiagarcia,45200,Spain,sofia@example.com
Marco Rossi,@marcorossi,120000,Italy,marco@example.com`;

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'influencers_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function Influencers() {
  const { influencers }  = useLoaderData();
  const actionData       = useActionData();
  const navigation       = useNavigation();
  const [showForm, setShowForm]     = useState(false);
  const [showImport, setShowImport] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <h2 style={{ margin: 0 }}>Influencers <span style={{ fontSize: '14px', fontWeight: '400', color: '#999' }}>({influencers.length})</span></h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setShowImport(v => !v); setShowForm(false); }}
            style={{ padding: '8px 16px', backgroundColor: showImport ? '#fff' : '#f5f5f5', color: '#000', border: '1px solid #ddd', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
            {showImport ? 'Cancel' : '↑ Import CSV'}
          </button>
          <button onClick={() => { setShowForm(v => !v); setShowImport(false); }}
            style={{ padding: '8px 16px', backgroundColor: showForm ? '#fff' : '#000', color: showForm ? '#000' : '#fff', border: '1px solid #000', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
            {showForm ? 'Cancel' : '+ Add Influencer'}
          </button>
        </div>
      </div>

      {/* Import result banner */}
      {actionData?.imported && (
        <div style={{ padding: '12px 16px', backgroundColor: '#d4edda', color: '#155724', borderRadius: '4px', marginBottom: '20px', fontWeight: '600', fontSize: '13px' }}>
          ✓ Successfully imported {actionData.imported} influencer{actionData.imported !== 1 ? 's' : ''}.
        </div>
      )}
      {actionData?.error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px', marginBottom: '20px', fontWeight: '600', fontSize: '13px' }}>
          ✗ {actionData.error}
        </div>
      )}

      {/* CSV Import panel */}
      {showImport && (
        <div style={{ padding: '24px', backgroundColor: '#f5f5f5', marginBottom: '32px', borderLeft: '3px solid #000' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '14px', marginBottom: '4px' }}>Import from CSV</div>
              <div style={{ fontSize: '12px', color: '#666' }}>Required columns: <code>name, handle</code> — Optional: <code>followers, country, email</code></div>
            </div>
            <button type="button" onClick={downloadTemplate}
              style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '600', border: '1px solid #000', background: '#fff', cursor: 'pointer' }}>
              ↓ Download Template
            </button>
          </div>
          <Form method="post" encType="multipart/form-data"
            onSubmit={() => setShowImport(false)}>
            <input type="hidden" name="intent" value="importCSV" />
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input type="file" name="csvFile" accept=".csv" required
                style={{ flex: 1, padding: '9px 10px', border: '1px solid #ddd', fontSize: '13px', backgroundColor: '#fff', cursor: 'pointer' }} />
              <button type="submit" disabled={isSubmitting}
                style={{ padding: '10px 24px', backgroundColor: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>
                {isSubmitting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Manual add form */}
      {showForm && (
        <Form method="post" onSubmit={() => { if (!isSubmitting) setShowForm(false); }}
          style={{ padding: '24px', backgroundColor: '#f5f5f5', marginBottom: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <input type="hidden" name="intent" value="create" />
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Full Name *
            <input name="name" required placeholder="Sofia García" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Handle *
            <input name="handle" required placeholder="@sofía_gs" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Followers
            <input name="followers" type="number" placeholder="45200" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Country *
            <input name="country" required placeholder="Spain" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', gridColumn: '1 / -1' }}>
            Email
            <input name="email" type="email" placeholder="sofia@example.com" style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
          </label>
          <button type="submit" disabled={isSubmitting}
            style={{ gridColumn: '1 / -1', padding: '11px', backgroundColor: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
            {isSubmitting ? 'Saving...' : 'Add Influencer'}
          </button>
        </Form>
      )}

      {/* Table */}
      {influencers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#999', border: '2px dashed #ddd' }}>
          <p style={{ margin: '0 0 8px', fontSize: '16px' }}>No influencers yet.</p>
          <p style={{ margin: 0, fontSize: '13px' }}>Add one manually or import a CSV.</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #000' }}>
              {['Handle', 'Name', 'Followers', 'Country', 'Email', ''].map(h => (
                <th key={h} style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {influencers.map(inf => (
              <tr key={inf.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px 8px', fontWeight: '700' }}>{inf.handle}</td>
                <td style={{ padding: '12px 8px' }}>{inf.name}</td>
                <td style={{ padding: '12px 8px', color: '#666' }}>{inf.followers?.toLocaleString()}</td>
                <td style={{ padding: '12px 8px', color: '#666' }}>{inf.country}</td>
                <td style={{ padding: '12px 8px', color: '#999' }}>{inf.email || '—'}</td>
                <td style={{ padding: '12px 8px' }}>
                  <Form method="post" onSubmit={e => { if (!confirm(`Delete ${inf.handle}?`)) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={inf.id} />
                    <button type="submit" style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
