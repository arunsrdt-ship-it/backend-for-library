const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

export function requireSameOriginMutation(req, res, next) {
  const origin = req.get('origin');
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'This request origin is not allowed.' });
  }
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'This request could not be verified.' });
  }
  return next();
}
