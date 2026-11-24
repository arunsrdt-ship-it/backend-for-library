import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { UserSession } from '../models/UserSession.js';
import { clearReaderSessionCookie, hashReaderSessionToken, optionalReaderAuth, readReaderSessionToken, READER_SESSION_MAX_AGE_MS, setReaderSessionCookie } from '../middleware/readerAuth.js';
import { requireSameOriginMutation } from '../middleware/requireSameOriginMutation.js';

const router = express.Router();
const scrypt = promisify(scryptCallback);
const PASSWORD_COST = 16_384;
const PASSWORD_BLOCK_SIZE = 8;
const PASSWORD_PARALLELIZATION = 1;
const PASSWORD_KEY_LENGTH = 64;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many account attempts. Wait a little and try again.' },
});

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_COST,
    r: PASSWORD_BLOCK_SIZE,
    p: PASSWORD_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${PASSWORD_COST}$${PASSWORD_BLOCK_SIZE}$${PASSWORD_PARALLELIZATION}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(32).toString('hex'));

async function verifyPassword(password, encodedHash) {
  const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false;

  const salt = Buffer.from(encodedSalt, 'base64url');
  const expected = Buffer.from(encodedKey, 'base64url');
  if (!salt.length || expected.length !== PASSWORD_KEY_LENGTH) return false;

  const actual = await scrypt(password, salt, expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, expected);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user) {
  return { id: String(user._id), email: user.email };
}

async function beginSession(user, res, statusCode = 200) {
  const token = randomBytes(32).toString('base64url');
  await UserSession.create({
    tokenHash: hashReaderSessionToken(token),
    userId: user._id,
    expiresAt: new Date(Date.now() + READER_SESSION_MAX_AGE_MS),
  });
  setReaderSessionCookie(res, token);
  res.set('Cache-Control', 'no-store');
  return res.status(statusCode).json({ user: publicUser(user) });
}

router.get('/me', optionalReaderAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.readerUser ? publicUser(req.readerUser) : null });
});

router.post('/register', authLimiter, requireSameOriginMutation, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || Buffer.byteLength(password) < 8 || Buffer.byteLength(password) > 128) {
      return res.status(400).json({ error: 'Password must be between 8 and 128 bytes.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ email, passwordHash });
    return beginSession(user, res, 201);
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with that email already exists.' });
    return next(error);
  }
});

router.post('/login', authLimiter, requireSameOriginMutation, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!validEmail(email) || typeof password !== 'string' || Buffer.byteLength(password) > 128) {
      return res.status(400).json({ error: 'Enter your email and password.' });
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    const validPassword = await verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user || !validPassword) return res.status(401).json({ error: 'Email or password is incorrect.' });

    return beginSession(user, res);
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', requireSameOriginMutation, async (req, res, next) => {
  try {
    const token = readReaderSessionToken(req);
    if (token && token.length <= 128) {
      await UserSession.deleteOne({ tokenHash: hashReaderSessionToken(token) });
    }
    clearReaderSessionCookie(res);
    res.set('Cache-Control', 'no-store');
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
