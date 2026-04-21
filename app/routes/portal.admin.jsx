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

// ── Component ──────────────────────────────────────────────────────────────────
export default function PortalAdmin() {
  const { locations, poolStats, discountMode: initialDiscountMode } = useLoaderData();
  const [discountMode, setDiscountModeLocal] = useState(initialDiscountMode ?? 'simple');
  const actionData  = useActionData();
  const nav         = useNavigation();
  const { t }       = useT();
  const busy        = nav.state !== 'idle';

  const [tab, setTab]           = useState('inventory');
  const [activePool, setActivePool] = useState('Product');

  const POOL = poolStats[activePool] || { Available: 0, Assigned: 0, Used: 0 };

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
            <>
              {/* Explanation */}
              <div style={{
                backgroundColor: 'rgba(124,111,247,0.04)',
                border: '1px solid rgba(124,111,247,0.18)',
                borderRadius: '12px',
                padding: '18px 20px',
              }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, marginBottom: '12px' }}>
                  How analytics codes work
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>🎟</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: D.text, marginBottom: '2px' }}>
                        Product codes — required
                      </div>
                      <div style={{ fontSize: '12px', color: D.textSub, lineHeight: 1.55 }}>
                        Create a batch of unique 100%-off discount codes in Shopify (Discounts → Generate codes), then import them here.
                        When a seeding is created, one code is assigned and baked into the influencer's checkout link via
                        Shopify's <code style={{ fontSize: '11px', backgroundColor: 'var(--pt-surface-high)', padding: '1px 5px', borderRadius: '4px' }}>/discount/</code> redirect.
                        Redemptions appear in your Shopify analytics.
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>🚚</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: D.text, marginBottom: '2px' }}>
                        Shipping codes — optional, Shopify Plus only
                      </div>
                      <div style={{ fontSize: '12px', color: D.textSub, lineHeight: 1.55 }}>
                        Without shipping codes, free shipping is baked into the draft order (works on all plans).
                        With shipping codes, Zeedy chains both codes via
                        <code style={{ fontSize: '11px', backgroundColor: 'var(--pt-surface-high)', padding: '1px 5px', borderRadius: '4px', margin: '0 3px' }}>/discount/PRODUCT?redirect=/discount/SHIPPING?redirect=…</code>
                        — Shopify Plus only.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '13px', color: D.textSub, lineHeight: 1.6 }}>
                Paste your unique codes below (comma or line separated). Each code is one-time use and must already exist in Shopify.
              </p>

              <div style={{ display: 'flex', gap: '8px' }}>
                {['Product', 'Shipping'].map(p => (
                  <button key={p} onClick={() => setActivePool(p)} style={{
                    padding: '7px 18px', fontSize: '12px', fontWeight: '700', borderRadius: '8px',
                    border: `1px solid ${D.border}`, cursor: 'pointer',
                    backgroundColor: activePool === p ? 'var(--pt-accent-light)' : 'var(--pt-surface)',
                    color: activePool === p ? 'var(--pt-accent)' : D.textSub,
                  }}>
                    {p} codes
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <StatusPill label="Available" count={POOL.Available} type="Available" />
                <StatusPill label="Assigned"  count={POOL.Assigned}  type="Assigned"  />
                <StatusPill label="Used"      count={POOL.Used}      type="Used"      />
              </div>

              <Form method="post">
                <input type="hidden" name="intent"   value="importCodes" />
                <input type="hidden" name="poolType" value={activePool}  />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: D.textSub, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Paste {activePool.toLowerCase()} codes
                  </label>
                  <textarea name="codes" placeholder={`CODE001\nCODE002\nCODE003`} rows={6} required
                    style={{ ...input.base, fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button type="submit" disabled={busy} style={{ ...btn.primary }}>
                      {busy ? 'Importing…' : `Import ${activePool} codes`}
                    </button>
                    <span style={{ fontSize: '11px', color: D.textMuted }}>Duplicate codes are silently skipped.</span>
                  </div>
                </div>
              </Form>

              <div style={{ padding: '16px', border: '1px solid #FCA5A5', borderRadius: '10px', backgroundColor: '#FFF5F5' }}>
                <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: '600', color: '#7F1D1D' }}>Danger zone</p>
                <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#991B1B' }}>
                  Remove all <strong>Available</strong> {activePool.toLowerCase()} codes. Assigned and used codes are kept.
                </p>
                <Form method="post" onSubmit={e => { if (!confirm(`Delete all available ${activePool.toLowerCase()} codes?`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent"   value="clearPool"  />
                  <input type="hidden" name="poolType" value={activePool} />
                  <button type="submit" disabled={busy} style={{
                    padding: '6px 16px', fontSize: '12px', fontWeight: '700', borderRadius: '7px',
                    border: '1px solid #FCA5A5', backgroundColor: '#FEE2E2', color: '#991B1B', cursor: 'pointer',
                  }}>
                    Clear available {activePool.toLowerCase()} codes
                  </button>
                </Form>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
