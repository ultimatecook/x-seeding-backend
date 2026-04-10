import { createCookieSessionStorage, redirect } from 'react-router';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// ── Password hashing ──────────────────────────────────────────────────────────

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, storedHash] = stored.split(':');
  const hash = await scryptAsync(password, salt, 64);
  const storedBuf = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(hash, storedBuf);
}

// ── Invite token ──────────────────────────────────────────────────────────────

export function generateInviteToken() {
  return randomBytes(32).toString('hex');
}

// ── Cookie session ────────────────────────────────────────────────────────────

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: '__portal_session',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [process.env.PORTAL_SESSION_SECRET || 'portal-secret-change-in-prod'],
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
});

export async function getPortalSession(request) {
  return sessionStorage.getSession(request.headers.get('Cookie'));
}

export async function commitPortalSession(session) {
  return sessionStorage.commitSession(session);
}

export async function destroyPortalSession(session) {
  return sessionStorage.destroySession(session);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function requirePortalUser(request) {
  const session = await getPortalSession(request);
  const userId  = session.get('portalUserId');
  const shop    = session.get('portalShop');
  if (!userId || !shop) {
    throw redirect('/portal/login');
  }
  return { userId: parseInt(userId), shop };
}

export async function getPortalUser(request) {
  try {
    const session = await getPortalSession(request);
    const userId  = session.get('portalUserId');
    const shop    = session.get('portalShop');
    if (!userId || !shop) return null;
    return { userId: parseInt(userId), shop };
  } catch {
    return null;
  }
}
