import { createHash } from 'node:crypto';
import { User } from '../models/User.js';
import { UserSession } from '../models/UserSession.js';

export const READER_SESSION_COOKIE = 'athenaeum_session';
export const READER_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function readReaderSessionToken(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== READER_SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export function hashReaderSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function setReaderSessionCookie(res, token) {
  res.cookie(READER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
    maxAge: READER_SESSION_MAX_AGE_MS,
  });
}

export function clearReaderSessionCookie(res) {
  res.clearCookie(READER_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
  });
}

export async function optionalReaderAuth(req, res, next) {
  try {
    const token = readReaderSessionToken(req);
    req.readerUser = null;
    if (!token || token.length > 128) return next();

    const session = await UserSession.findOne({
      tokenHash: hashReaderSessionToken(token),
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!session) return next();

    req.readerUser = await User.findById(session.userId).select('_id email createdAt').lean();
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireReaderAuth(req, res, next) {
  if (!req.readerUser) return res.status(401).json({ error: 'Sign in to access your saved books.' });
  return next();
}
