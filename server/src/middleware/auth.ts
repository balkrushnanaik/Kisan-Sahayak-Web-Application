import type { NextFunction, Request, Response } from 'express';
import { User } from '../models/index.js';
import { HttpError } from '../utils/http.js';

export type SafeUser = {
  _id: unknown; name: string; email?: string; mobile?: string; roles: string[]; activeRole?: 'farmer' | 'labourer' | 'machinery_provider'; preferredLanguage: string; status: string;
  farmerProfile?: unknown; labourerProfile?: unknown; providerProfile?: unknown; avatarUrl?: string;
};

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.session.userId) throw new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED');
    const user = await User.findById(req.session.userId).select('-passwordHash');
    if (!user || user.status !== 'active') {
      req.session.destroy(() => undefined);
      throw new HttpError(401, 'Your session is no longer active. Please sign in again.', 'SESSION_INACTIVE');
    }
    resLocals(req).user = user.toJSON() as SafeUser;
    next();
  } catch (error) { next(error); }
}

function resLocals(req: Request) {
  // Express locals are response-scoped; keep a typed user on the request for downstream middleware.
  return { set user(value: SafeUser) { (req as Request & { authUser?: SafeUser }).authUser = value; }, get user() { return (req as Request & { authUser?: SafeUser }).authUser!; } };
}

export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as Request & { authUser?: SafeUser }).authUser;
    if (!user) return next(new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED'));
    if (!roles.some((role) => user.roles.includes(role))) return next(new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
    next();
  };
}

export function getAuthUser(req: Request): SafeUser {
  const user = (req as Request & { authUser?: SafeUser }).authUser;
  if (!user) throw new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED');
  return user;
}
