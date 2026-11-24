import mongoose from 'mongoose';
import app from './app.js';
import { configureCloudinary } from './config/cloudinary.js';
import { Book } from './models/Book.js';
import { User } from './models/User.js';
import { UserSession } from './models/UserSession.js';
import { Bookmark } from './models/Bookmark.js';

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error('MONGODB_URI is missing. Copy backend/.env.example to backend/.env and configure it.');
}

configureCloudinary();
try {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  await Promise.all([Book.init(), User.init(), UserSession.init(), Bookmark.init()]);
} catch {
  console.error('Could not connect to MongoDB or initialize its book index. Check MONGODB_URI and database access.');
  process.exit(1);
}

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Grand Athenaeum API listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; closing API server.`);
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
