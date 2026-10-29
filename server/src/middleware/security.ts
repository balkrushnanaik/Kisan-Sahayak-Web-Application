import type { RequestHandler } from 'express';
import { HttpError } from '../utils/http.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** SameSite cookies plus a required custom header help mitigate cross-site form submissions. */
export const requireMutationHeader: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  // This middleware is mounted at /api, so req.path is relative to that mount.
  // Require the header consistently for every mutating API, including authentication.
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') {
    return next(new HttpError(403, 'Security header missing. Refresh the page and try again.', 'CSRF_CHECK_FAILED'));
  }
  next();
};
