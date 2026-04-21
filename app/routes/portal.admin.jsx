/**
 * /portal/admin — Admin settings for inventory source rules and discount code pools.
 * Only Owners can access this page.
 */
import { useState, useRef } from 'react';
import { Form, useLoaderData, useActionData, useNavigation } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { requirePermission } from '../utils/portal-permissions';
import { getInventoryLocations, syncLocations } from '../utils/inventory.server';
import { getPoolStats } from '../utils/discount-codes.server';
import { D, Pbtn as btn, Pinput as input } from '../utils/portal-theme';
import { useT } from '../utils/i18n';

// ── Loader ─────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'manageUsers');

  const [locations, poolStats, billing] = await Promise.all([
    getInventoryLocations(shop, true /* includeDisabled */),
    getPoolStats(shop),
    prisma.shopBilling.findUnique({ where: { shop }, select: { discountMode: true } }),
  ]);

  return { locations, poolStats, discountMode: billing?.discountMode ?? 'simple' };
}

// ── Action ─────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'manageUsers');

  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'setDiscountMode') {
    const mode = formData.get('mode');
    if (!['simple', 'analytics'].includes(mode)) return { error: 'Invalid mode.' };
    await prisma.shopBilling.update({ where: { shop }, data: { discountMode: mode } });
    return { ok: true };
  }

  if (intent === 'syncLocations') {
    const { count, error } = await syncLocations(shop);
    if (error) return { error };
    return { ok: true, message: `Synced ${count} location${count !== 1 ? 's' : ''} from Shopify.` };
  }

  if (intent === 'addLocation') {
    const name  = String(formData.get('name') || '').trim();
    if (!name) return { error: 'Location name is required.' };
    const rawId = String(formData.get('shopifyLocationId') || '').trim();
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

  if (intent === 'toggleLocation') {
    const id        = parseInt(formData.get('locationId'));
    const isEnabled = formData.get('isEnabled') === 'true';
    await prisma.inventoryLocation.updateMany({ where: { id, shop }, data: { isEnabled } });
    return { ok: true };
  }

  if (intent === 'updateLocationType') {
    const id           = parseInt(formData.get('locationId'));
    const locationType = formData.get('locationType'); // 'Online' | 'Store'
    if (!['Online', 'Store'].includes(locationType)) return null;
    await prisma.inventoryLocation.updateMany({ where: { id, shop }, data: { locationType } });
    return { ok: true };
  }

  if (intent === 'moveLocation') {
    const id        = parseInt(formData.get('locationId'));
    const direction = formData.get('direction');

    const all = await prisma.inventoryLocation.findMany({
      where:   { shop },
      orderBy: [{ priorityOrder: 'asc' }, { name: 'asc' }],
    });

    const idx = all.findIndex(l => l.id === id);
    if (idx === -1) return null;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= all.length) return null;

    [all[idx], all[swapIdx]] = [all[swapIdx], all[idx]];
    await Promise.all(
      all.map((l, i) =>
        prisma.inventoryLocation.update({ where: { id: l.id }, data: { priorityOrder: i } })
      )
    );
    return { ok: true };
  }

  if (intent === 'importCodes') {
    const poolType = formData.get('poolType');
    const raw      = String(formData.get('codes') || '');
    if (!['Product', 'Shipping'].includes(poolType)) return { error: 'Invalid pool type.' };

    const codes = raw.split(/[\n,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
    if (codes.length === 0) return { error: 'No codes found.' };
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

    return { ok: true, message: `Imported ${inserted} ${poolType.toLowerCase()} code${inserted !== 1 ? 's' : ''}.` };
  }

  if (intent === 'deleteLocation') {
    const id = parseInt(formData.get('locationId'));
    await prisma.inventoryLocation.deleteMany({ where: { id, shop } });
    return { ok: true, message: 'Location removed.' };
  }

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

// ── PoolCard ──────────────────────────────────────────────────────────────────
function PoolCard({ poolType, stats, busy }) {
  const [codesText, setCodesText] = useState('');
  const [showClear, setShowClear] = useState(false);
  const textareaRef = useRef(null);

  const isProduct  = poolType === 'Product';
  const available  = stats?.Available ?? 0;
  const assigned   = stats?.Assigned  ?? 0;
  const used       = stats?.Used      ?? 0;
  const total      = available + assigned + used;
  const lowStock   = available < 10 && available > 0;
  const empty      = available === 0;

  // Count codes entered in the textarea
  const pendingCount = codesText.trim()
    ? codesText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length
    : 0;

  return (
    <div style={{
      border: `1px solid ${D.border}`,
      borderRadius: '14px',
      overflow: 'hidden',
      backgroundColor: 'var(--pt-surface)',
    }}>
      {/* Card header */}
      <div style={{
        padding: '16px 18px',
        borderBottom: `1px solid ${D.border}`,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '9px', flexShrink: 0,
            backgroundColor: isProduct ? 'rgba(124,111,247,0.1)' : 'rgba(16,185,129,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: '16px' }}>{isProduct ? '🎟' : '🚚'}</span>
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>
              {isProduct ? 'Product codes' : 'Shipping codes'}
            </div>
            <div style={{ fontSize: '11px', color: D.textSub, marginTop: '1px' }}>
              {isProduct
                ? 'Required — one assigned per seeding'
                : 'Optional — Shopify Plus only'}
            </div>
          </div>
        </div>
        {/* Status badge */}
        {empty ? (
          <span style={{
            fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '20px',
            backgroundColor: isProduct ? '#FEE2E2' : '#F3F4F6',
            color: isProduct ? '#991B1B' : D.textMuted,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {isProduct ? 'No codes — required' : 'No codes'}
          </span>
        ) : lowStock ? (
          <span style={{
            fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '20px',
            backgroundColor: '#FEF3C7', color: '#92400E', flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            ⚠ Low — {available} left
          </span>
        ) : (
          <span style={{
            fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '20px',
            backgroundColor: '#DCFCE7', color: '#166534', flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {available} available
          </span>
        )}
      </div>

      {/* Stats bar */}
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${D.border}`, display: 'flex', gap: '16px' }}>
        {[
          { label: 'Available', val: available, color: '#10B981' },
          { label: 'Assigned',  val: assigned,  color: '#7C6FF7' },
          { label: 'Used',      val: used,       color: D.textMuted },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '16px', fontWeight: '800', color, lineHeight: 1 }}>{val}</span>
            <span style={{ fontSize: '10px', color: D.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
          </div>
        ))}
        {total > 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: '8px' }}>
            <div style={{ width: '100%', height: '6px', borderRadius: '99px', backgroundColor: 'var(--pt-surface-high)', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${total ? (available / total) * 100 : 0}%`, backgroundColor: '#10B981', transition: 'width 0.3s' }} />
              <div style={{ width: `${total ? (assigned / total) * 100 : 0}%`, backgroundColor: '#7C6FF7', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
      </div>

      {/* Import form */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: D.textSub, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Import codes</span>
          {pendingCount > 0 && (
            <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--pt-accent)', textTransform: 'none', letterSpacing: 0 }}>
              {pendingCount} code{pendingCount !== 1 ? 's' : ''} detected
            </span>
          )}
        </div>
        <Form method="post" onSubmit={() => setCodesText('')}>
          <input type="hidden" name="intent"   value="importCodes" />
          <input type="hidden" name="poolType" value={poolType} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              ref={textareaRef}
              name="codes"
              value={codesText}
              onChange={e => setCodesText(e.target.value)}
              placeholder={'CODE001\nCODE002\nCODE003'}
              rows={5}
              required
              style={{ ...input.base, fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button type="submit" disabled={busy || pendingCount === 0} style={{
                ...btn.primary,
                opacity: pendingCount === 0 ? 0.5 : 1,
                cursor: pendingCount === 0 ? 'not-allowed' : 'pointer',
              }}>
                {busy ? 'Importing…' : `Import${pendingCount > 0 ? ` ${pendingCount}` : ''} code${pendingCount !== 1 ? 's' : ''}`}
              </button>
              <span style={{ fontSize: '11px', color: D.textMuted }}>Duplicates are skipped.</span>
            </div>
          </div>
        </Form>
      </div>

      {/* Danger zone (collapsed by default) */}
      <div style={{ padding: '0 18px 14px' }}>
        {!showClear ? (
          <button onClick={() => setShowClear(true)} style={{
            background: 'none', border: 'none', padding: 0, fontSize: '11px',
            color: D.textMuted, cursor: 'pointer', textDecoration: 'underline',
          }}>
            Clear available codes…
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Form method="post" onSubmit={e => { if (!confirm(`Delete all available ${poolType.toLowerCase()} codes?`)) e.preventDefault(); else setShowClear(false); }}>
              <input type="hidden" name="intent"   value="clearPool" />
              <input type="hidden" name="poolType" value={poolType} />
              <button type="submit" disabled={busy} style={{
                padding: '5px 12px', fontSize: '11px', fontWeight: '700', borderRadius: '7px',
                border: '1px solid #FCA5A5', backgroundColor: '#FEE2E2', color: '#991B1B', cursor: 'pointer',
              }}>
                Delete {available} available {poolType.toLowerCase()} codes
              </button>
            </Form>
            <button onClick={() => setShowClear(false)} style={{
              background: 'none', border: 'none', padding: 0, fontSize: '11px',
              color: D.textMuted, cursor: 'pointer',
            }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AnalyticsPoolSection ───────────────────────────────────────────────────────
function AnalyticsPoolSection({ poolStats, busy }) {
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Live store notice */}
      <div style={{
        display: 'flex', gap: '10px', padding: '12px 14px',
        backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px',
      }}>
        <span style={{ fontSize: '14px', flexShrink: 0 }}>⚠️</span>
        <div style={{ fontSize: '12px', color: '#78350F', lineHeight: 1.5 }}>
          <strong>Requires a live production store.</strong> The <code style={{ fontSize: '11px', backgroundColor: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: '3px' }}>/discount/</code> redirect
          is blocked on password-protected stores. Switch to <strong>Simple</strong> mode if you're testing on a development store.
        </div>
      </div>

      {/* Setup guide (collapsible) */}
      <div style={{ border: `1px solid ${D.border}`, borderRadius: '12px', overflow: 'hidden' }}>
        <button
          onClick={() => setGuideOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: '700', color: D.text,
          }}
        >
          <span>📋 How to get discount codes from Shopify</span>
          <span style={{ fontSize: '11px', color: D.textMuted, fontWeight: '500' }}>{guideOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
        {guideOpen && (
          <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${D.border}` }}>
            <ol style={{ margin: '12px 0 0', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                <>In Shopify admin, go to <strong>Discounts</strong> → <strong>Create discount</strong> → <strong>Discount code</strong>.</>,
                <>Set type to <strong>Amount off order</strong>, value <strong>100%</strong>, applies to <strong>All products</strong>.</>,
                <>Under <strong>Usage limits</strong>, enable <strong>Limit to one use per customer</strong>.</>,
                <>Click <strong>Generate codes</strong> (top right), set quantity to how many seedings you plan to run, and export the CSV.</>,
                <>Copy the codes from the CSV and paste them into the import box below. Repeat for shipping codes if you're on Shopify Plus.</>,
              ].map((step, i) => (
                <li key={i} style={{ fontSize: '12px', color: D.textSub, lineHeight: 1.55 }}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Pool cards */}
      <PoolCard poolType="Product"  stats={poolStats.Product}  busy={busy} />
      <PoolCard poolType="Shipping" stats={poolStats.Shipping} busy={busy} />
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function PortalAdmin() {
  const { locations, poolStats, discountMode: initialDiscountMode } = useLoaderData();
  const [discountMode, setDiscountModeLocal] = useState(initialDiscountMode ?? 'simple');
  const actionData  = useActionData();
  const nav         = useNavigation();
  const { t }       = useT();
  const busy        = nav.state !== 'idle';

  const [tab, setTab] = useState('inventory');

  return (
    <div style={{ maxWidth: '760px', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      <div>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>{t('admin.title')}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: D.textSub }}>Manage inventory source rules and discount code pools.</p>
      </div>

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
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${D.border}` }}>
        {['inventory', 'discounts'].map(tabKey => (
          <button key={tabKey} onClick={() => setTab(tabKey)} style={{
            padding: '10px 18px', fontSize: '13px',
            fontWeight: tab === tabKey ? '700' : '500',
            color: tab === tabKey ? 'var(--pt-accent)' : D.textSub,
            background: 'none', border: 'none',
            borderBottom: tab === tabKey ? '2px solid var(--pt-accent)' : '2px solid transparent',
            marginBottom: '-1px', cursor: 'pointer',
          }}>
            {tabKey === 'inventory' ? t('admin.tabs.inventory') : t('admin.tabs.discount')}
          </button>
        ))}
      </div>

      {/* ── Inventory tab ─────────────────────────────────────────────────── */}
      {tab === 'inventory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          <p style={{ margin: 0, fontSize: '13px', color: D.textSub, lineHeight: 1.6 }}>
            Sync your Shopify locations, then set each one as <strong>Online</strong> (fulfillment warehouse) or <strong>Store</strong> (physical retail).
            The top-priority Online location is used for online seedings. For in-store seedings the user picks the store at creation time.
          </p>

          <Form method="post">
            <input type="hidden" name="intent" value="syncLocations" />
            <button type="submit" disabled={busy} style={{ ...btn.primary, fontSize: '13px' }}>
              {busy ? t('admin.inventory.syncing') : t('admin.inventory.sync')}
            </button>
          </Form>

          {locations.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: D.textMuted, fontSize: '13px', border: `1px dashed ${D.border}`, borderRadius: '12px' }}>
              No locations yet. Click Sync from Shopify above.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {locations.map((loc, idx) => (
                <div key={loc.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '12px 16px',
                  backgroundColor: 'var(--pt-surface)',
                  border: `1px solid ${D.border}`,
                  borderRadius: '10px',
                  opacity: loc.isEnabled ? 1 : 0.55,
                }}>
                  {/* Up / Down */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <Form method="post">
                      <input type="hidden" name="intent"     value="moveLocation" />
                      <input type="hidden" name="locationId" value={String(loc.id)} />
                      <input type="hidden" name="direction"  value="up" />
                      <button type="submit" disabled={idx === 0 || busy} title="Move up"
                        style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? D.border : D.textSub, fontSize: '12px', padding: '1px 4px', display: 'block' }}>▲</button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent"     value="moveLocation" />
                      <input type="hidden" name="locationId" value={String(loc.id)} />
                      <input type="hidden" name="direction"  value="down" />
                      <button type="submit" disabled={idx === locations.length - 1 || busy} title="Move down"
                        style={{ background: 'none', border: 'none', cursor: idx === locations.length - 1 ? 'default' : 'pointer', color: idx === locations.length - 1 ? D.border : D.textSub, fontSize: '12px', padding: '1px 4px', display: 'block' }}>▼</button>
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

                  {/* Location type toggle: Online | Store */}
                  <Form method="post" style={{ display: 'flex' }}>
                    <input type="hidden" name="intent"       value="updateLocationType" />
                    <input type="hidden" name="locationId"   value={String(loc.id)} />
                    <input type="hidden" name="locationType" value={loc.locationType === 'Online' ? 'Store' : 'Online'} />
                    <button type="submit" disabled={busy} title="Toggle location type" style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '4px 10px',
                      fontSize: '11px', fontWeight: '700',
                      borderRadius: '6px',
                      border: `1px solid ${D.border}`,
                      background: loc.locationType === 'Store' ? '#FFF7ED' : '#EFF6FF',
                      color:      loc.locationType === 'Store' ? '#92400E' : '#1E40AF',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}>
                      {loc.locationType === 'Store' ? t('admin.inventory.type.Store') : t('admin.inventory.type.Online')}
                    </button>
                  </Form>

                  {/* Enable / disable */}
                  <Form method="post">
                    <input type="hidden" name="intent"     value="toggleLocation" />
                    <input type="hidden" name="locationId" value={String(loc.id)} />
                    <input type="hidden" name="isEnabled"  value={loc.isEnabled ? 'false' : 'true'} />
                    <button type="submit" disabled={busy} style={{
                      padding: '4px 12px', fontSize: '11px', fontWeight: '700', borderRadius: '6px',
                      border: `1px solid ${D.border}`,
                      background: loc.isEnabled ? '#DCFCE7' : '#FEE2E2',
                      color:      loc.isEnabled ? '#166534' : '#991B1B',
                      cursor: 'pointer',
                    }}>
                      {loc.isEnabled ? t('admin.inventory.disable') : t('admin.inventory.enable')}
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

          {/* Mode toggle */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, marginBottom: '4px' }}>
              Checkout mode
            </div>
            <div style={{ fontSize: '12px', color: D.textSub, marginBottom: '12px', lineHeight: 1.5 }}>
              Choose how influencer checkout links are generated for each seeding.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {[
                {
                  value: 'simple',
                  icon: '⚡',
                  title: 'Simple',
                  subtitle: 'Recommended',
                  desc: 'Free products and shipping are baked directly into the draft order. Works on all Shopify plans with zero setup — no codes needed.',
                },
                {
                  value: 'analytics',
                  icon: '📊',
                  title: 'Analytics',
                  subtitle: 'Shopify Plus recommended',
                  desc: 'Real Shopify discount codes are applied at checkout via the /discount/ redirect chain. Lets you track redemptions per influencer in Shopify analytics.',
                },
              ].map(opt => {
                const selected = discountMode === opt.value;
                return (
                  <Form key={opt.value} method="post" style={{ display: 'contents' }} onChange={e => { setDiscountModeLocal(opt.value); e.currentTarget.requestSubmit(); }}>
                    <input type="hidden" name="intent" value="setDiscountMode" />
                    <input type="hidden" name="mode"   value={opt.value} />
                    <label style={{
                      display: 'flex', flexDirection: 'column', gap: '6px',
                      padding: '14px 16px', borderRadius: '12px', cursor: 'pointer',
                      border: `2px solid ${selected ? 'var(--pt-accent)' : D.border}`,
                      backgroundColor: selected ? 'var(--pt-accent-light)' : 'var(--pt-surface)',
                      transition: 'border-color 0.15s, background-color 0.15s',
                    }}>
                      <input type="radio" name="_modeRadio" value={opt.value} checked={selected} onChange={() => {}} style={{ display: 'none' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px', lineHeight: 1 }}>{opt.icon}</span>
                        <div>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: selected ? 'var(--pt-accent)' : D.text }}>
                            {opt.title}
                          </span>
                          <span style={{
                            marginLeft: '7px', fontSize: '10px', fontWeight: '700',
                            color: selected ? 'var(--pt-accent)' : D.textMuted,
                            textTransform: 'uppercase', letterSpacing: '0.4px',
                          }}>
                            {opt.subtitle}
                          </span>
                        </div>
                        {selected && (
                          <span style={{ marginLeft: 'auto', fontSize: '14px', color: 'var(--pt-accent)' }}>✓</span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: D.textSub, lineHeight: 1.5 }}>
                        {opt.desc}
                      </div>
                    </label>
                  </Form>
                );
              })}
            </div>
          </div>

          {/* Analytics mode: code pool management */}
          {discountMode === 'analytics' && (
            <AnalyticsPoolSection poolStats={poolStats} busy={busy} />
          )}
        </div>
      )}
    </div>
  );
}
