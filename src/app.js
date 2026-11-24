import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { isCloudinaryConfigured } from './config/cloudinary.js';
import { Book } from './models/Book.js';
import booksRouter from './routes/books.js';
import authRouter from './routes/auth.js';
import bookmarksRouter from './routes/bookmarks.js';
import multiplayerRouter from './routes/multiplayer.js';

const app = express();
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173, https://the-grand-athenaeum-nine.vercel.app')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.disable('x-powered-by');
app.use('/api', helmet());
app.use('/api', cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Token', 'X-Requested-With'],
  maxAge: 600,
}));
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    databaseConnected: Book.db.readyState === 1,
    cloudinaryConfigured: isCloudinaryConfigured(),
  });
});
app.use('/api/auth', authRouter);
app.use('/api/me/bookmarks', bookmarksRouter);
app.use('/api/books', booksRouter);
app.use('/api/multiplayer', multiplayerRouter);

if (process.env.NODE_ENV === 'production' || process.argv.includes('--serve-static')) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const distDirectory = path.join(projectRoot, 'frontend', 'dist');
  app.use(express.static(distDirectory, { index: false, fallthrough: true }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(distDirectory, 'index.html'), (error) => error && next(error));
      return;
    }
    next();
  });
}

app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? `PDF is too large. The limit is ${Math.max(1, Number(process.env.MAX_PDF_SIZE_MB) || 100)} MB.`
        : 'The upload form could not be processed.',
    });
  }

  if (error?.code === 11000) {
    return res.status(409).json({ error: 'That shelf slot was updated by another upload. Refresh the catalog and try again.' });
  }
  if (error?.name === 'ValidationError') {
    return res.status(400).json({ error: 'The book details are invalid.' });
  }

  const statusCode = Number(error.statusCode) || 500;
  if (statusCode >= 500) console.error('Backend request failed:', error.message);
  const message = statusCode >= 500 ? 'The backend could not complete the request.' : error.message;
  return res.status(statusCode).json({ error: message });
});

export default app;
