/**
 * /portal/admin — Admin settings for inventory source rules and discount code pools.
 * Only Owners can access this page.
 */
import { useState } from 'react';
import { Form, useLoaderData, useActionData, useNavigation } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { requirePermission } from '../utils/portal-permissions';
import { getInventoryLocations, syncLocations } from '../utils/inventory.server';
import { getPoolStats } from '../utils/discount-codes.server';
import { D, Pbtn as btn, Pinput as input } from '../utils/portal-theme';

// ── Loader ─────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'manageUsers'); // Owner / Admin only

  const [locations, poolStats] = await Promise.all([
    getInventoryLocations(shop, true /* includeDisabled */),
    getPoolStats(shop),
  ]);

  return { locations, poolStats };
}

// ── Action ─────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'manageUsers');

  const formData = await request.formData();
  const intent   = formData.get('intent');

  // ── Sync from Shopify ────────────────────────────────────────────────────
  if (intent === 'syncLocations') {
    const { count, error } = await syncLocations(shop);
    if (error) return { error };
    return { ok: true, message: `Synced ${count} location${count !== 1 ? 's' : ''} from Shopify.` };
  }

  // ── Add location manually ────────────────────────────────────────────────
  if (intent === 'addLocation') {
    const name    = String(formData.get('name') || '').trim();
    if (!name) return { error: 'Location name is required.' };
    const rawId   = String(formData.get('shopifyLocationId') || '').trim();
    const shopifyLocationId = rawId
      ? (rawId.startsWith('gid://') ? rawId : `gid://shopify/Location/${rawId}`)
      : `manual_${Date.now()}`;
    await prisma.inventoryLocation.upsert({
      where:  { shop_shopifyLocationId: { shop, shopifyLocationId } },
      update: { name },
      create: { shop, shopifyLocationId, name, isEnabled: true, priorityOrder: 999 },
    });
    return { ok: true, message: `Location "${name}" added.` };
  }

  // ── Toggle location enabled ──────────────────────────────────────────────
  if (intent === 'toggleLocation') {
    const id        = parseInt(formData.get('locationId'));
    const isEnabled = formData.get('isEnabled') === 'true';
    await prisma.inventoryLocation.updateMany({
      where: { id, shop },
      data:  { isEnabled },
    });
    return { ok: true };
  }

  // ── Move location up or down ─────────────────────────────────────────────
  if (intent === 'moveLocation') {
    const id        = parseInt(formData.get('locationId'));
    const direction = formData.get('direction'); // 'up' | 'down'

    const all = await prisma.inventoryLocation.findMany({
      where:   { shop },
      orderBy: [{ priorityOrder: 'asc' }, { name: 'asc' }],
    });

    const idx = all.findIndex(l => l.id === id);
    if (idx === -1) return null;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= all.length) return null;

    // Swap
    [all[idx], all[swapIdx]] = [all[swapIdx], all[idx]];

    // Persist new order
    await Promise.all(
      all.map((l, i) =>
        prisma.inventoryLocation.update({ where: { id: l.id }, data: { priorityOrder: i } })
      )
    );

    return { ok: true };
  }

  // ── Import discount codes ────────────────────────────────────────────────
  if (intent === 'importCodes') {
    const poolType = formData.get('poolType'); // 'Product' | 'Shipping'
    const raw      = String(formData.get('codes') || '');
    if (!['Product', 'Shipping'].includes(poolType)) return { error: 'Invalid pool type.' };

    const codes = raw
      .split(/[\n,]+/)
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);

    if (codes.length === 0) return { error: 'No codes found. Paste codes separated by commas or new lines.' };
    if (codes.length > 5000) return { error: 'Maximum 5 000 codes per import.' };

    let inserted = 0;
    for (const code of codes) {
      try {
        await prisma.discountCode.upsert({
          where:  { shop_code: { shop, code } },
          update: {},
          create: { shop, poolType, code, status: 'Available' },
        });
        inserted++;
      } catch (_) {}
    }
    return { ok: true, message: `Imported ${inserted} ${poolType.toLowerCase()} codes.` };
  }

  // ── Delete location ──────────────────────────────────────────────────────
  if (intent === 'deleteLocation') {
    const id = parseInt(formData.get('locationId'));
    await prisma.inventoryLocation.deleteMany({ where: { id, shop } });
    return { ok: true, message: 'Location removed.' };
  }

  // ── Delete available codes from a pool ───────────────────────────────────
  if (intent === 'clearPool') {
    const poolType = formData.get('poolType');
    if (!['Product', 'Shipping'].includes(poolType)) return { error: 'Invalid pool type.' };
    const { count } = await prisma.discountCode.deleteMany({
      where: { shop, poolType, status: 'Available' },
    });
    return { ok: true, message: `Cleared ${count} available ${poolType.toLowerCase()} codes.` };
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function gidToNumeric(gid) {
  return gid?.split('/').pop() ?? gid;
}

const TAG = {
  Available: { bg: '#DCFCE7', color: '#166534' },
  Assigned:  { bg: '#DBEAFE', color: '#1E40AF' },
  Used:      { bg: '#F3F4F6', color: '#374151' },
};

function StatusPill({ label, count, type }) {
  const s = TAG[type] || TAG.Used;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontSize: '11px', fontWeight: '700',
      backgroundColor: s.bg, color: s.color,
      borderRadius: '20px', padding: '3px 10px',
    }}>
      {label}: {count}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function PortalAdmin() {
  const { locations, poolStats } = useLoaderData();
  const actionData  = useActionData();
  const nav         = useNavigation();
  const busy        = nav.state !== 'idle';

  const [tab, setTab]           = useState('inventory');
  const [activePool, setActivePool] = useState('Product');

  const POOL = poolStats[activePool] || { Available: 0, Assigned: 0, Used: 0 };

  return (
    <div style={{ maxWidth: '760px', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
          Admin
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: D.textSub }}>
          Manage inventory source rules and discount code pools.
        </p>
      </div>

      {/* Flash */}
      {actionData?.error && (
        <div style={{ padding: '10px 16px', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>
          {actionData.error}
        </div>
      )}
      {actionData?.ok && actionData?.message && (
        <div style={{ padding: '10px 16px', backgroundColor: '#DCFCE7', color: '#166534', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>
          {actionData.message}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${D.border}`, paddingBottom: '0' }}>
        {['inventory', 'discounts'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: tab === t ? '700' : '500',
              color: tab === t ? 'var(--pt-accent)' : D.textSub,
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--pt-accent)' : '2px solid transparent',
              marginBottom: '-1px',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t === 'inventory' ? 'Inventory Rules' : 'Discount Codes'}
          </button>
        ))}
      </div>

      {/* ── Inventory tab ─────────────────────────────────────────────────── */}
      {tab === 'inventory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          <p style={{ margin: 0, fontSize: '13px', color: D.textSub, lineHeight: 1.6 }}>
            Sync your Shopify locations below, then set priority order. When a seeding is created,
            stock is pulled from the top-priority enabled location.
          </p>

          {/* Sync from Shopify */}
          <Form method="post">
            <input type="hidden" name="intent" value="syncLocations" />
            <button type="submit" disabled={busy} style={{ ...btn.primary, fontSize: '13px' }}>
              {busy ? 'Syncing…' : '↻ Sync from Shopify'}
            </button>
          </Form>

          {locations.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: D.textMuted, fontSize: '13px', border: `1px dashed ${D.border}`, borderRadius: '12px' }}>
              No locations yet. Click Sync from Shopify above.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {locations.map((loc, idx) => (
                <div
                  key={loc.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 16px',
                    backgroundColor: 'var(--pt-surface)',
                    border: `1px solid ${D.border}`,
                    borderRadius: '10px',
                    opacity: loc.isEnabled ? 1 : 0.55,
                  }}
                >
                  {/* Up / Down — each is its own form so it submits immediately */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <Form method="post">
                      <input type="hidden" name="intent"     value="moveLocation" />
                      <input type="hidden" name="locationId" value={String(loc.id)} />
                      <input type="hidden" name="direction"  value="up" />
                      <button
                        type="submit"
                        disabled={idx === 0 || busy}
                        title="Move up"
                        style={{
                          background: 'none', border: 'none',
                          cursor: idx === 0 ? 'default' : 'pointer',
                          color: idx === 0 ? D.border : D.textSub,
                          fontSize: '12px', padding: '1px 4px', display: 'block',
                        }}
                      >▲</button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent"     value="moveLocation" />
                      <input type="hidden" name="locationId" value={String(loc.id)} />
                      <input type="hidden" name="direction"  value="down" />
                      <button
                        type="submit"
                        disabled={idx === locations.length - 1 || busy}
                        title="Move down"
                        style={{
                          background: 'none', border: 'none',
                          cursor: idx === locations.length - 1 ? 'default' : 'pointer',
                          color: idx === locations.length - 1 ? D.border : D.textSub,
                          fontSize: '12px', padding: '1px 4px', display: 'block',
                        }}
                      >▼</button>
                    </Form>
                  </div>

                  {/* Priority badge */}
                  <span style={{
                    minWidth: '26px', height: '26px', borderRadius: '50%',
                    backgroundColor: loc.isEnabled ? 'var(--pt-accent-light)' : D.surfaceHigh,
                    color: loc.isEnabled ? 'var(--pt-accent)' : D.textMuted,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: '800', flexShrink: 0,
                  }}>{idx + 1}</span>

                  {/* Name + ID */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: D.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {loc.name}
                    </div>
                    <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px' }}>
                      ID: {gidToNumeric(loc.shopifyLocationId)}
                    </div>
                  </div>

                  {/* Enable / disable toggle */}
                  <Form method="post">
                    <input type="hidden" name="intent"     value="toggleLocation" />
                    <input type="hidden" name="locationId" value={String(loc.id)} />
                    <input type="hidden" name="isEnabled"  value={loc.isEnabled ? 'false' : 'true'} />
                    <button
                      type="submit"
                      disabled={busy}
                      style={{
                        padding: '4px 12px',
                        fontSize: '11px', fontWeight: '700',
                        borderRadius: '6px',
                        border: `1px solid ${D.border}`,
                        background: loc.isEnabled ? '#DCFCE7' : '#FEE2E2',
                        color:      loc.isEnabled ? '#166534' : '#991B1B',
                        cursor: 'pointer',
                      }}
                    >
                      {loc.isEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </Form>

                  {/* Delete */}
                  <Form method="post" onSubmit={e => { if (!confirm(`Remove "${loc.name}"?`)) e.preventDefault(); }}>
                    <input type="hidden" name="intent"     value="deleteLocation" />
                    <input type="hidden" name="locationId" value={String(loc.id)} />
                    <button type="submit" disabled={busy} style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 4px' }}>×</button>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Discounts tab ─────────────────────────────────────────────────── */}
      {tab === 'discounts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          <p style={{ margin: 0, fontSize: '13px', color: D.textSub, lineHeight: 1.6 }}>
            Pre-load unique discount codes here. When a new seeding is created, one code
            from each pool is automatically assigned to it. Import codes as a comma-separated
            or line-separated list.
          </p>

          {/* Pool selector */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {['Product', 'Shipping'].map(p => (
              <button
                key={p}
                onClick={() => setActivePool(p)}
                style={{
                  padding: '7px 18px',
                  fontSize: '12px', fontWeight: '700',
                  borderRadius: '8px',
                  border: `1px solid ${D.border}`,
                  cursor: 'pointer',
                  backgroundColor: activePool === p ? 'var(--pt-accent-light)' : 'var(--pt-surface)',
                  color: activePool === p ? 'var(--pt-accent)' : D.textSub,
                }}
              >
                {p} codes
              </button>
            ))}
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <StatusPill label="Available" count={POOL.Available} type="Available" />
            <StatusPill label="Assigned"  count={POOL.Assigned}  type="Assigned"  />
            <StatusPill label="Used"      count={POOL.Used}      type="Used"      />
          </div>

          {/* Import form */}
          <Form method="post">
            <input type="hidden" name="intent"   value="importCodes" />
            <input type="hidden" name="poolType" value={activePool}  />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', color: D.textSub, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Paste {activePool.toLowerCase()} codes
              </label>
              <textarea
                name="codes"
                placeholder={`CODE001\nCODE002\nCODE003`}
                rows={6}
                required
                style={{
                  ...input.base,
                  fontFamily: 'monospace',
                  fontSize:   '12px',
                  resize:     'vertical',
                  width:      '100%',
                  boxSizing:  'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button type="submit" disabled={busy} style={{ ...btn.primary }}>
                  {busy ? 'Importing…' : `Import ${activePool} codes`}
                </button>
                <span style={{ fontSize: '11px', color: D.textMuted }}>
                  Duplicate codes are silently skipped.
                </span>
              </div>
            </div>
          </Form>

          {/* Clear pool */}
          <div style={{
            padding: '16px',
            border: `1px solid #FCA5A5`,
            borderRadius: '10px',
            backgroundColor: '#FFF5F5',
          }}>
            <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: '600', color: '#7F1D1D' }}>
              Danger zone
            </p>
            <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#991B1B' }}>
              Remove all <strong>Available</strong> {activePool.toLowerCase()} codes from the pool.
              Assigned and used codes are kept.
            </p>
            <Form method="post"
              onSubmit={e => {
                if (!confirm(`Delete all available ${activePool.toLowerCase()} codes? This cannot be undone.`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent"   value="clearPool"   />
              <input type="hidden" name="poolType" value={activePool}  />
              <button
                type="submit"
                disabled={busy}
                style={{
                  padding: '6px 16px',
                  fontSize: '12px', fontWeight: '700',
                  borderRadius: '7px',
                  border: '1px solid #FCA5A5',
                  backgroundColor: '#FEE2E2',
                  color: '#991B1B',
                  cursor: 'pointer',
                }}
              >
                Clear available {activePool.toLowerCase()} codes
              </button>
            </Form>
          </div>

        </div>
      )}
    </div>
  );
}
