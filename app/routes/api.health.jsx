import prisma from '../db.server';

export async function loader() {
  const start = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - start;

    return Response.json({
      status: 'ok',
      db: 'connected',
      responseTimeMs: ms,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      {
        status: 'error',
        db: 'unreachable',
        error: err.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
