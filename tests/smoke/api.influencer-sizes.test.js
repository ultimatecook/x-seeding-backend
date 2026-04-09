import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../app/db.server';
import { authenticate } from '../../app/shopify.server';
import { action, loader } from '../../app/routes/api.influencer-sizes';

vi.mock('../../app/shopify.server', () => ({
  authenticate: {
    admin: vi.fn(async () => ({ admin: {} })),
  },
}));

vi.mock('../../app/db.server', () => ({
  default: {
    influencerSavedSize: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe('api.influencer-sizes smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loader devuelve 400 cuando falta influencerId', async () => {
    const request = new Request('http://localhost/api/influencer-sizes');
    const response = await loader({ request });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'influencerId required',
    });
  });

  it('action bloquea metodos distintos de POST/PUT', async () => {
    const request = new Request('http://localhost/api/influencer-sizes', { method: 'GET' });
    const response = await action({ request });

    expect(authenticate.admin).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Method not allowed',
    });
  });

  it('action valida body incompleto', async () => {
    const request = new Request('http://localhost/api/influencer-sizes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ influencerId: 10, category: 'tops' }),
    });
    const response = await action({ request });

    expect(response.status).toBe(400);
    expect(prisma.influencerSavedSize.upsert).not.toHaveBeenCalled();
  });
});
