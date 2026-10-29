import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  statusCode: number;
  code?: string;
  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

export function parseObjectId(value: string, label = 'id'): string {
  if (!/^[a-f\d]{24}$/i.test(value)) throw new HttpError(400, `Invalid ${label}.`, 'INVALID_ID');
  return value;
}

export function pagination(query: Request['query']) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(String(query.page ?? '1'), 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(String(query.limit ?? '12'), 10) || 12));
  return { page, limit, skip: (page - 1) * limit };
}

export function sendPage<T>(res: Response, items: T[], total: number, page: number, limit: number) {
  return res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}
