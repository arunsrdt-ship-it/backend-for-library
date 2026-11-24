import mongoose from 'mongoose';

const userSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  expiresAt: { type: Date, required: true, expires: 0 },
}, {
  timestamps: true,
  versionKey: false,
});

export const UserSession = mongoose.model('UserSession', userSessionSchema);
