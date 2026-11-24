import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { Book } from '../models/Book.js';
import { optionalAdminUploadToken, requireAdminUploadToken } from '../middleware/requireAdminUploadToken.js';
import { createTemporaryPdfUrl, deletePrivatePdf, uploadPrivatePdf } from '../config/cloudinary.js';

const router = express.Router();
const maxPdfSizeBytes = Math.max(1, Number(process.env.MAX_PDF_SIZE_MB) || 100) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPdfSizeBytes, files: 1, fields: 6, fieldSize: 2048 },
  fileFilter(_req, file, callback) {
    const hasPdfName = path.extname(file.originalname).toLowerCase() === '.pdf';
    const acceptableMime = ['application/pdf', 'application/octet-stream', ''].includes(file.mimetype);
    if (!acceptableMime || !hasPdfName) {
      const error = new Error('Choose a PDF file.');
      error.statusCode = 415;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Upload limit reached. Try again later.' },
});

function textField(value, field, maxLength, { required = false } = {}) {
  const cleaned = typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '') : '';
  if (required && !cleaned) {
    const error = new Error(`${field} is required.`);
    error.statusCode = 400;
    throw error;
  }
  if (cleaned.length > maxLength) {
    const error = new Error(`${field} must be ${maxLength} characters or fewer.`);
    error.statusCode = 400;
    throw error;
  }
  return cleaned;
}

function serializeBook(book) {
  return {
    id: String(book._id),
    shelfSlot: book.shelfSlot,
    title: book.title,
    author: book.author,
    category: book.category,
    year: book.year,
    visibility: book.visibility || 'public',
    pdfName: book.originalFileName,
    pdfUrl: `/api/books/${book._id}/pdf`,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

router.get('/', optionalAdminUploadToken, async (req, res, next) => {
  try {
    const filter = req.isLibraryOwner
      ? {}
      : { $or: [{ visibility: 'public' }, { visibility: { $exists: false } }] };
    const books = await Book.find(filter).sort({ shelfSlot: 1 }).lean();
    res.set('Cache-Control', 'no-store');
    res.json({ books: books.map(serializeBook) });
  } catch (error) {
    next(error);
  }
});

router.post('/', uploadLimiter, requireAdminUploadToken, upload.single('pdf'), async (req, res, next) => {
  let uploadedAsset;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Choose a PDF file to upload.' });
    }

    const pdfHeader = Buffer.from('%PDF-');
    if (req.file.buffer.subarray(0, 1024).indexOf(pdfHeader) === -1) {
      return res.status(415).json({ error: 'The selected file does not contain a valid PDF header.' });
    }

    const title = textField(req.body.title, 'Book title', 160, { required: true });
    const author = textField(req.body.author, 'Author', 120);
    const category = textField(req.body.category, 'Category', 80) || 'My Books';
    const year = textField(req.body.year, 'Year', 20);
    const visibility = req.body.visibility || 'public';
    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ error: 'Choose public or private book access.' });
    }
    const shelfSlot = Number(req.body.shelfSlot);
    if (!Number.isInteger(shelfSlot) || shelfSlot < 0 || shelfSlot > 11) {
      return res.status(400).json({ error: 'Choose a valid library shelf slot.' });
    }

    const originalFileName = path.basename(req.file.originalname.replaceAll('\\', '/'))
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 200) || 'book.pdf';
    const sha256 = createHash('sha256').update(req.file.buffer).digest('hex');
    const previousBook = await Book.findOne({ shelfSlot }).select('+cloudinaryPublicId +cloudinaryAssetId');

    uploadedAsset = await uploadPrivatePdf(req.file.buffer);
    const bookData = {
      shelfSlot,
      title,
      author,
      category,
      year,
      visibility,
      originalFileName,
      cloudinaryPublicId: uploadedAsset.public_id,
      cloudinaryAssetId: uploadedAsset.asset_id,
      sha256,
    };

    let book;
    try {
      book = previousBook
        ? await Book.findByIdAndUpdate(previousBook._id, { $set: bookData }, { new: true, runValidators: true })
        : await Book.create(bookData);
    } catch (error) {
      await deletePrivatePdf(uploadedAsset.public_id).catch(() => {});
      uploadedAsset = null;
      throw error;
    }

    if (previousBook?.cloudinaryPublicId) {
      await deletePrivatePdf(previousBook.cloudinaryPublicId).catch((error) => {
        console.error('Could not remove replaced Cloudinary PDF:', error.message);
      });
    }

    const statusCode = previousBook ? 200 : 201;
    return res.status(statusCode).json({ book: serializeBook(book) });
  } catch (error) {
    if (uploadedAsset?.public_id) {
      await deletePrivatePdf(uploadedAsset.public_id).catch(() => {});
    }
    return next(error);
  }
});

router.get('/:id/pdf', optionalAdminUploadToken, async (req, res, next) => {
  const abortController = new AbortController();
  const abortForClientDisconnect = () => abortController.abort();
  const abortForResponseClose = () => {
    if (!res.writableEnded) abortController.abort();
  };

  req.once('aborted', abortForClientDisconnect);
  res.once('close', abortForResponseClose);
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      return res.status(404).json({ error: 'Book not found.' });
    }

    const book = await Book.findById(req.params.id).select('+cloudinaryPublicId');
    if (!book) return res.status(404).json({ error: 'Book not found.' });
    if (book.visibility === 'private' && !req.isLibraryOwner) {
      return res.status(404).json({ error: 'Book not found.' });
    }

    const signedUrl = createTemporaryPdfUrl(book.cloudinaryPublicId);
    const upstream = await fetch(signedUrl, { signal: abortController.signal });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      return res.status(502).json({ error: 'The stored PDF could not be retrieved.' });
    }

    const headers = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="book.pdf"',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'none',
    };
    res.status(200).set(headers);

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    if (abortController.signal.aborted || error.name === 'AbortError') return;
    if (error.statusCode) return next(error);
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    console.error('Could not stream the stored PDF:', error.message);
    return res.status(502).json({ error: 'The stored PDF could not be retrieved.' });
  } finally {
    req.off('aborted', abortForClientDisconnect);
    res.off('close', abortForResponseClose);
  }
});

export default router;
