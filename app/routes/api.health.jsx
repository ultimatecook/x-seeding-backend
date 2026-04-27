import prisma from '../db.server';
import { rateLimit, getClientIp, tooManyRequests } from '../utils/rate-limit.server';
import { handlePreflight, withCors } from '../utils/security.server';

export async function loader({ request }) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  // 10 requests per minute per IP
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = rateLimit(`health:${ip}`, 10, 60_000);
  if (!allowed) return tooManyRequests(retryAfterMs);

  const start = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - start;

    return withCors(request, Response.json({
      status: 'ok',
      db: 'connected',
      responseTimeMs: ms,
      timestamp: new Date().toISOString(),
    }));
  } catch (err) {
    return withCors(request, Response.json(
      {
        status: 'error',
        db: 'unreachable',
        error: err.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    ));
  }
}
