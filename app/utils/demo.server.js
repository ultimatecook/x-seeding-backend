/**
 * Demo data utilities for onboarding.
 *
 * Creates a small set of realistic-looking demo records (influencers, campaign,
 * seedings) so new users can explore the app immediately. All demo records are
 * flagged with isDemo=true so they can be bulk-deleted at any time.
 */
import prisma from '../db.server';

// ── Demo seed data ────────────────────────────────────────────────────────────
const DEMO_INFLUENCERS = [
  {
    handle:    'sofia_creates',
    name:      'Sofia Martinez',
    followers: 45200,
    country:   'Spain',
    city:      'Madrid',
    gender:    'Female',
    email:     'sofia@example.com',
    notes:     'Fashion & lifestyle micro-influencer. Very engaged audience.',
    styleTags: 'minimalist, streetwear, sustainable',
    isDemo:    true,
  },
  {
    handle:    'jakewilsonfit',
    name:      'Jake Wilson',
    followers: 12800,
    country:   'United Kingdom',
    city:      'London',
    gender:    'Male',
    email:     'jake@example.com',
    notes:     'Fitness & outdoors nano-influencer.',
    styleTags: 'sporty, outdoor, athleisure',
    isDemo:    true,
  },
];

const DEMO_CAMPAIGN = {
  title:     'Demo: Summer Drop 2026',
  type:      'seeding',
  budget:    2500,
  startDate: new Date('2026-05-01'),
  endDate:   new Date('2026-07-31'),
  isDemo:    true,
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns true if any demo data exists for this shop. */
export async function hasDemoData(shop) {
  const count = await prisma.influencer.count({
    where: { shop, isDemo: true },
  });
  return count > 0;
}

/**
 * Seed demo data for this shop.
 * Safe to call multiple times — skips if demo data already exists.
 * Returns { created: boolean }.
 */
export async function seedDemoData(shop) {
  const exists = await hasDemoData(shop);
  if (exists) return { created: false };

  // Create demo influencers
  const [sofia, jake] = await Promise.all(
    DEMO_INFLUENCERS.map(inf =>
      prisma.influencer.create({ data: { ...inf, shop } })
    )
  );

  // Create demo campaign
  const campaign = await prisma.campaign.create({
    data: { ...DEMO_CAMPAIGN, shop },
  });

  // Create 2 demo seedings with fake products
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const oneWeekAgo  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);

  await prisma.seeding.create({
    data: {
      shop,
      influencerId:  sofia.id,
      campaignId:    campaign.id,
      status:        'Delivered',
      seedingType:   'Online',
      totalCost:     189.00,
      notes:         '(Demo seeding) Summer lookbook send — delivered and posted.',
      trackingNumber: 'ES123456789',
      trackingCarrier:'DHL',
      createdAt:     twoWeeksAgo,
      products: {
        create: [
          { productId: 'demo-1', productName: 'Linen Midi Dress',   price: 129.00, imageUrl: null, size: 'S', category: 'dresses' },
          { productId: 'demo-2', productName: 'Canvas Tote Bag',    price:  60.00, imageUrl: null, size: 'One Size', category: null },
        ],
      },
    },
  });

  await prisma.seeding.create({
    data: {
      shop,
      influencerId: jake.id,
      campaignId:   campaign.id,
      status:       'Shipped',
      seedingType:  'Online',
      totalCost:    210.00,
      notes:        '(Demo seeding) Active collection send — in transit.',
      trackingNumber: 'GB987654321',
      trackingCarrier:'UPS',
      createdAt:    oneWeekAgo,
      products: {
        create: [
          { productId: 'demo-3', productName: 'Performance Running Tee', price: 85.00, imageUrl: null, size: 'M', category: 'tops'    },
          { productId: 'demo-4', productName: 'Trail Shorts',            price: 75.00, imageUrl: null, size: 'M', category: 'bottoms' },
          { productId: 'demo-5', productName: 'Water Bottle',            price: 50.00, imageUrl: null, size: 'One Size', category: null },
        ],
      },
    },
  });

  return { created: true };
}

/**
 * Delete all demo data for this shop.
 * Removes seedings → saved sizes → influencers → campaign.
 */
export async function deleteDemoData(shop) {
  // Find demo influencer IDs
  const demoInfluencers = await prisma.influencer.findMany({
    where:  { shop, isDemo: true },
    select: { id: true },
  });
  const demoIds = demoInfluencers.map(i => i.id);

  if (demoIds.length > 0) {
    // Find seedings belonging to demo influencers
    const demoSeedings = await prisma.seeding.findMany({
      where:  { shop, influencerId: { in: demoIds } },
      select: { id: true },
    });
    const demoSeedingIds = demoSeedings.map(s => s.id);

    // Delete seeding products first (no cascade)
    if (demoSeedingIds.length > 0) {
      await prisma.seedingProduct.deleteMany({ where: { seedingId: { in: demoSeedingIds } } });
      await prisma.discountCode.updateMany({
        where: { assignedSeedingId: { in: demoSeedingIds } },
        data:  { status: 'Available', assignedSeedingId: null },
      });
      await prisma.seeding.deleteMany({ where: { id: { in: demoSeedingIds } } });
    }

    // Delete saved sizes
    await prisma.influencerSavedSize.deleteMany({ where: { influencerId: { in: demoIds } } });

    // Delete demo influencers
    await prisma.influencer.deleteMany({ where: { id: { in: demoIds } } });
  }

  // Delete demo campaigns
  const demoCampaigns = await prisma.campaign.findMany({
    where:  { shop, isDemo: true },
    select: { id: true },
  });
  if (demoCampaigns.length > 0) {
    const campIds = demoCampaigns.map(c => c.id);
    await prisma.campaignProduct.deleteMany({ where: { campaignId: { in: campIds } } });
    await prisma.campaign.deleteMany({ where: { id: { in: campIds } } });
  }
}

/**
 * Returns the current onboarding state for the checklist.
 * All counts exclude demo data.
 */
export async function getOnboardingState(shop) {
  const [realInfluencers, realSeedings, realCampaigns, productCodes, hasDemo] = await Promise.all([
    prisma.influencer.count({ where: { shop, archived: false, isDemo: false } }),
    prisma.seeding.count({
      where: {
        shop,
        influencer: { isDemo: false },
      },
    }),
    prisma.campaign.count({ where: { shop, archived: false, isDemo: false } }),
    prisma.discountCode.count({ where: { shop, poolType: 'Product', status: 'Available' } }),
    hasDemoData(shop),
  ]);

  return {
    hasInfluencer:  realInfluencers > 0,
    hasSeeding:     realSeedings    > 0,
    hasCampaign:    realCampaigns   > 0,
    hasDiscountCodes: productCodes  > 0,
    hasDemo,
    // All steps done → hide checklist
    allDone: realInfluencers > 0 && realSeedings > 0,
  };
}
