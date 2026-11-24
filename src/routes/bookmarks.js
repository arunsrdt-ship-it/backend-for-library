import express from 'express';
import mongoose from 'mongoose';
import { Bookmark } from '../models/Bookmark.js';
import { Book } from '../models/Book.js';
import { optionalAdminUploadToken } from '../middleware/requireAdminUploadToken.js';
import { optionalReaderAuth, requireReaderAuth } from '../middleware/readerAuth.js';
import { requireSameOriginMutation } from '../middleware/requireSameOriginMutation.js';

const router = express.Router();
const curatedBookKey = /^my-book-(?:0[1-9]|1[0-2])$/;

async function validBookKey(bookKey, isLibraryOwner) {
  if (curatedBookKey.test(bookKey)) return true;
  if (!mongoose.isObjectIdOrHexString(bookKey)) return false;

  const book = await Book.findById(bookKey).select('visibility').lean();
  return Boolean(book && (book.visibility !== 'private' || isLibraryOwner));
}

router.get('/', optionalReaderAuth, requireReaderAuth, async (req, res, next) => {
  try {
    const bookmarks = await Bookmark.find({ userId: req.readerUser._id }).select('bookKey -_id').lean();
    res.set('Cache-Control', 'no-store');
    return res.json({ bookmarks: bookmarks.map(({ bookKey }) => ({ bookKey })) });
  } catch (error) {
    return next(error);
  }
});

router.put('/:bookKey', optionalAdminUploadToken, requireSameOriginMutation, optionalReaderAuth, requireReaderAuth, async (req, res, next) => {
  try {
    const bookKey = req.params.bookKey;
    if (bookKey.length > 64 || !(await validBookKey(bookKey, req.isLibraryOwner))) {
      return res.status(404).json({ error: 'Book not found or unavailable.' });
    }

    await Bookmark.updateOne(
      { userId: req.readerUser._id, bookKey },
      { $setOnInsert: { userId: req.readerUser._id, bookKey } },
      { upsert: true },
    );
    res.set('Cache-Control', 'no-store');
    return res.status(204).end();
  } catch (error) {
    if (error?.code === 11000) return res.status(204).end();
    return next(error);
  }
});

router.delete('/:bookKey', requireSameOriginMutation, optionalReaderAuth, requireReaderAuth, async (req, res, next) => {
  try {
    if (req.params.bookKey.length > 64) return res.status(404).json({ error: 'Bookmark not found.' });
    await Bookmark.deleteOne({ userId: req.readerUser._id, bookKey: req.params.bookKey });
    res.set('Cache-Control', 'no-store');
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
