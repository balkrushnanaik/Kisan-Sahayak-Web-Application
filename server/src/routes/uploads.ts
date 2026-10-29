import { Router } from 'express';
import multer from 'multer';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { env, uploadDirectory } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/http.js';

export const uploadsRouter = Router();
const allowed = new Map<string, string>([['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/avif', '.avif']]);
const uploadDir = uploadDirectory;
const storage = multer.diskStorage({ destination: (_req, _file, callback) => { void mkdir(uploadDir, { recursive: true }).then(() => callback(null, uploadDir)).catch((error) => callback(error as Error, uploadDir)); }, filename: (_req, file, callback) => callback(null, `${randomUUID()}${allowed.get(file.mimetype) ?? extname(file.originalname).toLowerCase()}`) });
const upload = multer({ storage, limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => allowed.has(file.mimetype) ? callback(null, true) : callback(new HttpError(415, 'Upload a JPEG, PNG, WebP or AVIF image.', 'UNSUPPORTED_FILE_TYPE')) });

uploadsRouter.post('/', requireAuth, (req, res, next) => {
  if (env.nodeEnv === 'production' && (process.env.STORAGE_PROVIDER ?? 'local') === 'local') return next(new HttpError(503, 'Image uploads are disabled in production until an object-storage provider is configured.', 'STORAGE_NOT_CONFIGURED'));
  upload.single('image')(req, res, (error) => {
    if (error) return next(error);
    if (!req.file) return next(new HttpError(422, 'Choose an image to upload.'));
    res.status(201).json({ data: { url: `${env.serverUrl}/uploads/${req.file.filename}`, name: req.file.originalname, size: req.file.size } });
  });
});
