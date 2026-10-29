import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { User } from './models/index.js';

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to the intended administrator email before running this script.');
  if (!password || password.length < 16 || /replace-with|change-me|password123/i.test(password)) throw new Error('Set ADMIN_PASSWORD to a unique password of at least 16 characters. Placeholder passwords are rejected.');
  await connectDatabase();
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ email }).select('+passwordHash');
  if (existing) {
    if (!existing.roles.includes('admin')) existing.roles.push('admin');
    existing.status = 'active';
    existing.passwordHash = passwordHash;
    if (!existing.termsAcceptedAt) existing.termsAcceptedAt = new Date();
    await existing.save();
    console.info(`Administrator role and credentials updated for ${email}.`);
  } else {
    await User.create({ name: 'Kisan Sahayak Administrator', email, passwordHash, roles: ['admin'], preferredLanguage: 'en', status: 'active', termsAcceptedAt: new Date() });
    console.info(`Administrator account created for ${email}.`);
  }
}

seedAdmin().catch((error) => { console.error('Admin seed failed:', error); process.exitCode = 1; }).finally(() => disconnectDatabase());
