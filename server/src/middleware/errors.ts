import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http.js';

export const notFound: RequestHandler = (req, _res, next) => next(new HttpError(404, `Route not found: ${req.method} ${req.path}`, 'NOT_FOUND'));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'The selected image exceeds the configured upload limit.' } });
    return;
  }
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(422).json({ error: { code: 'INVALID_UPLOAD', message: 'Upload one supported image at a time.' } });
    return;
  }
  if (error?.message === 'Origin is not allowed by CORS.') {
    res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This website origin is not allowed to access the API.' } });
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'The request is larger than the API accepts.' } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the highlighted fields.', details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } });
    return;
  }
  if (error instanceof mongoose.Error.ValidationError) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Some submitted information is invalid.' } });
    return;
  }
  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'The requested record identifier is invalid.' } });
    return;
  }
  if (error?.code === 11000) {
    res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'This record already exists.' } });
    return;
  }
  const status = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof HttpError ? error.message : 'Something went wrong. Please try again.';
  if (status >= 500) console.error('[api-error]', error);
  res.status(status).json({ error: { code: error instanceof HttpError ? error.code ?? 'REQUEST_FAILED' : 'INTERNAL_ERROR', message } });
};
