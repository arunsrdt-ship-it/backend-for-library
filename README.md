# Grand Athenaeum backend

The Express API stores book metadata in MongoDB and uploads PDFs to Cloudinary as authenticated raw assets. The Cloudinary public ID and asset ID are excluded from book queries. The backend streams each PDF through `/api/books/:id/pdf` and keeps the temporary Cloudinary URL server-side.

## Configure

1. Copy `.env.example` to `.env` in this `backend` folder.
2. Set `MONGODB_URI` to a local MongoDB connection string or an Atlas connection string.
3. Fill in `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` from the Cloudinary dashboard.
4. Set `ADMIN_UPLOAD_TOKEN` to a unique random secret of at least 32 bytes. You can generate one with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

Keep `.env` private. The root `.gitignore` excludes it. Do not put Cloudinary credentials or the admin token in Vite variables or source files.

## Run locally

Install the frontend and backend dependencies from the project root:

```sh
npm --prefix frontend install
npm --prefix backend install
```

Start MongoDB, then run the frontend and backend in separate terminals:

```sh
npm run dev
npm run dev:backend
```

The React app and its Redux Toolkit API layer live in `frontend/`. The Vite dev server proxies `/api` to `http://127.0.0.1:4000`. For production, run `npm run build` and then `npm run start:backend`; the Express server serves `frontend/dist` and the API together.

## API behavior

Visitors can browse and read public books without signing in. Reader accounts let each person keep bookmarks across devices. A valid ADMIN_UPLOAD_TOKEN gives the owner access to private books and upload/replace operations. Upload visibility is stored with each book, accepts public or private, and is enforced by both the catalog endpoint and the PDF endpoint.

- `GET /api/books` returns book metadata and the backend PDF route, never Cloudinary credentials or storage identifiers.
- `POST /api/books` requires `X-Admin-Token` and multipart fields `pdf`, `title`, `author`, `category`, `year`, and `shelfSlot`. Shelf slots 0–11 are unique; uploading to an occupied slot replaces its PDF.
- `GET /api/books/:id/pdf` streams the stored PDF through the backend. Public PDFs are readable without a token; private PDFs require the valid owner token.
- `POST /api/auth/register` and `POST /api/auth/login` create an account or start a reader session. Both accept JSON `{ "email", "password" }` and set an HttpOnly, SameSite=Lax session cookie.
- `GET /api/auth/me` returns the current reader account or `null`; `POST /api/auth/logout` ends its session.
- `GET /api/me/bookmarks` lists the signed-in reader's saved book keys. `PUT` and `DELETE /api/me/bookmarks/:bookKey` add and remove a bookmark for that account.
- `GET /api/health` reports database and Cloudinary configuration status without returning secrets.

Reader passwords are hashed with Node's scrypt implementation. Reader sessions expire after 30 days; MongoDB stores only a hash of each session token and removes expired session records with a TTL index. Bookmark records are keyed by both account and book, so one reader cannot see or change another reader's saved books. Existing device-only bookmarks are migrated to the account at sign-in.

The access roles are **visitor** (read public books), **reader** (visitor access plus a personal bookmark list), and **owner** (valid ADMIN_UPLOAD_TOKEN; can read all books and upload or replace PDFs). The owner token stays in frontend memory for the current page session and is cleared when owner access is locked or the page is closed. It remains one shared owner credential, separate from reader accounts. Account recovery and email verification are not configured by this app yet.

For deployments that serve the frontend separately, set `CLIENT_ORIGINS` to the exact frontend origins. The API uses credentialed CORS and same-origin checks for account and bookmark changes; serve the frontend and API on the same site so the Lax session cookie is sent reliably.

Uploads are limited to one PDF at a time and 100 MB by default. The backend checks the file name, declared MIME type, and PDF header, applies a per-IP upload rate limit, and keeps Cloudinary secrets server-side. Legacy records without a visibility field remain public.
