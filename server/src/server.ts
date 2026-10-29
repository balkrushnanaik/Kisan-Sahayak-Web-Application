import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';

async function start() {
  await connectDatabase();
  const server = app.listen(env.port, () => console.info(`Kisan Sahayak API listening on ${env.serverUrl} (database connected)`));
  const shutdown = async (signal: string) => {
    console.info(`${signal} received, shutting down gracefully`);
    server.close(async () => { await disconnectDatabase(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((error) => { console.error('Unable to start Kisan Sahayak API. Check MongoDB and environment configuration.', error); process.exit(1); });
