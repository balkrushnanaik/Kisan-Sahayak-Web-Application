import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { env, uploadDirectory } from './config/env.js';
import { requireMutationHeader } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { applicationsRouter, jobsRouter, labourersRouter } from './routes/marketplace.js';
import { assignmentsRouter, workRequestsRouter } from './routes/work.js';
import { bookingsRouter, machineryRouter } from './routes/machinery.js';
import { adminRouter, dashboardRouter, notificationsRouter, reportsRouter, reviewsRouter } from './routes/system.js';
import { uploadsRouter } from './routes/uploads.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.nodeEnv === 'production' ? 1 : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin(origin, callback) {
  if (!origin || origin === env.clientUrl) return callback(null, true);
  callback(new Error('Origin is not allowed by CORS.'));
}, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-Requested-With'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
if (env.nodeEnv !== 'production') app.use('/uploads', express.static(uploadDirectory, { fallthrough: false, maxAge: '1h' }));

app.use(session({
  name: env.sessionName,
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({ mongoUrl: env.mongoUri, collectionName: 'sessions', ttl: 60 * 60 * 24 * 7, autoRemove: 'native' }),
  cookie: { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', maxAge: 1000 * 60 * 60 * 24 * 7, path: '/' },
}));
app.use('/api', requireMutationHeader);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } } });
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);

app.get('/healthz', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not_ready', database: ready ? 'connected' : 'disconnected', timestamp: new Date().toISOString() });
});
app.get('/api/v1', (_req, res) => res.json({ name: 'Kisan Sahayak API', version: 'v1', documentation: '/api/v1/docs', health: '/healthz' }));
app.get('/api/v1/docs', (_req, res) => res.json({
  authentication: ['/auth/register', '/auth/login', '/auth/logout', '/auth/me', '/auth/activate-role', '/auth/active-role'],
  jobs: ['/jobs', '/jobs/:id', '/jobs/:id/applications', '/jobs/:id/close', '/jobs/:id/cancel'],
  workers: ['/labourers', '/labourers/:id'],
  applications: ['/applications/mine', '/applications/:id'],
  offers: ['/work-requests', '/work-requests/mine', '/work-requests/:id/respond', '/work-requests/:id/counter-offer'],
  assignments: ['/assignments/mine', '/assignments/:id/start', '/assignments/:id/complete', '/assignments/:id/cancel'],
  machinery: ['/machinery', '/machinery/mine', '/machinery/:id'],
  bookings: ['/bookings', '/bookings/mine', '/bookings/:id/respond', '/bookings/:id/counter-offer'],
  shared: ['/notifications', '/reviews', '/reports', '/dashboard/summary'],
  admin: ['/admin/overview', '/admin/users', '/admin/listings', '/admin/reports', '/admin/audit'],
  note: 'All mutation requests require the X-Requested-With: XMLHttpRequest header and a valid session where indicated. API responses use { data } or { error } envelopes.',
}));

const api = '/api/v1';
app.use(`${api}/auth`, authRouter);
app.use(`${api}/jobs`, jobsRouter);
app.use(`${api}/labourers`, labourersRouter);
app.use(`${api}/applications`, applicationsRouter);
app.use(`${api}/work-requests`, workRequestsRouter);
app.use(`${api}/assignments`, assignmentsRouter);
app.use(`${api}/machinery`, machineryRouter);
app.use(`${api}/bookings`, bookingsRouter);
app.use(`${api}/notifications`, notificationsRouter);
app.use(`${api}/reviews`, reviewsRouter);
app.use(`${api}/reports`, reportsRouter);
app.use(`${api}/uploads`, uploadsRouter);
app.use(`${api}/dashboard`, dashboardRouter);
app.use(`${api}/admin`, adminRouter);

app.use(notFound);
app.use(errorHandler);
