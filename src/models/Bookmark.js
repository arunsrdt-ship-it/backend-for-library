import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  bookKey: { type: String, required: true, maxlength: 64 },
}, {
  timestamps: true,
  versionKey: false,
});

bookmarkSchema.index({ userId: 1, bookKey: 1 }, { unique: true });

export const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
