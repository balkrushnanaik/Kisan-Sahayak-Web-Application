import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isProduction = process.env.NODE_ENV === 'production';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:4000',
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/kisan_sahayak?replicaSet=rs0',
  sessionSecret: process.env.SESSION_SECRET ?? (isProduction ? '' : 'local-development-secret-change-this-before-deploying-123456'),
  sessionName: process.env.SESSION_NAME ?? 'ks.sid',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || isProduction,
  maxUploadMb: Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 5)),
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
};

if (env.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters. Set it in your environment.');
}

/** Resolve uploads relative to the server package, regardless of the command's working directory. */
export const uploadDirectory = resolve(fileURLToPath(new URL('../../', import.meta.url)), env.uploadDir);
