import { timingSafeEqual } from 'node:crypto';

export function hasValidAdminUploadToken(provided) {
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || Buffer.byteLength(expected) < 32) return false;

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided ?? '');
  return expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes);
}

export function requireAdminUploadToken(req, res, next) {
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  const provided = req.get('x-admin-token') ?? '';

  if (!expected || Buffer.byteLength(expected) < 32) {
    return res.status(503).json({ error: 'Owner access is not configured on the backend.' });
  }

  if (!hasValidAdminUploadToken(provided)) {
    return res.status(401).json({ error: 'The owner access token is invalid.' });
  }

  return next();
}

export function optionalAdminUploadToken(req, res, next) {
  if (!req.get('x-admin-token')) {
    req.isLibraryOwner = false;
    return next();
  }

  return requireAdminUploadToken(req, res, () => {
    req.isLibraryOwner = true;
    return next();
  });
}
