import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';

export function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET,
  );
}

export function uploadPrivatePdf(buffer) {
  if (!isCloudinaryConfigured()) {
    const error = new Error('Cloudinary is not configured on the backend.');
    error.statusCode = 503;
    throw error;
  }

  return new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream({
      resource_type: 'raw',
      type: 'authenticated',
      folder: 'grand-athenaeum/books',
      public_id: `${randomUUID()}.pdf`,
      overwrite: false,
      unique_filename: false,
    }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });

    Readable.from([buffer]).pipe(upload);
  });
}

export function createTemporaryPdfUrl(publicId) {
  if (!isCloudinaryConfigured()) {
    const error = new Error('Cloudinary is not configured on the backend.');
    error.statusCode = 503;
    throw error;
  }

  return cloudinary.utils.private_download_url(publicId, 'pdf', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    attachment: false,
  });
}

export async function deletePrivatePdf(publicId) {
  if (!publicId || !isCloudinaryConfigured()) return;
  await cloudinary.uploader.destroy(publicId, {
    resource_type: 'raw',
    type: 'authenticated',
    invalidate: true,
  });
}
