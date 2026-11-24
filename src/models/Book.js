import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema({
  shelfSlot: { type: Number, required: true, min: 0, max: 11 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  author: { type: String, trim: true, maxlength: 120, default: '' },
  category: { type: String, trim: true, maxlength: 80, default: 'My Books' },
  year: { type: String, trim: true, maxlength: 20, default: '' },
  visibility: { type: String, enum: ['public', 'private'], default: 'public', required: true },
  originalFileName: { type: String, required: true, maxlength: 200 },
  cloudinaryPublicId: { type: String, required: true, select: false },
  cloudinaryAssetId: { type: String, required: true, select: false },
  sha256: { type: String, required: true, select: false },
}, {
  timestamps: true,
  versionKey: false,
});

bookSchema.index({ shelfSlot: 1 }, { unique: true });

export const Book = mongoose.model('Book', bookSchema);
