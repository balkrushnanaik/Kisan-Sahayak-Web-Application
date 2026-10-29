import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/index.js';
import { getAuthUser, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/http.js';

export const authRouter = Router();
const mobileSchema = z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Enter a valid mobile number.').optional().or(z.literal(''));
const baseCredentials = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) });

const locationSchema = z.object({
  village: z.string().trim().max(100).optional().default(''),
  taluka: z.string().trim().max(100).optional().default(''),
  district: z.string().trim().max(100).optional().default(''),
  state: z.string().trim().max(100).optional().default('Maharashtra'),
  point: z.object({
    type: z.literal('Point').default('Point'),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }).optional(),
});
const wageSchema = z.object({
  amount: z.number().min(0).max(10000000),
  basis: z.enum(['hour', 'worker_day', 'task']),
  currency: z.literal('INR').default('INR'),
});

function normaliseMobile(value?: string) {
  if (!value) return undefined;
  const cleaned = value.replace(/[\s()-]/g, '');
  return cleaned || undefined;
}

function publicUser(user: any) {
  const value = typeof user.toJSON === 'function' ? user.toJSON() : user;
  delete value.passwordHash;
  delete value.__v;
  return value;
}

authRouter.post('/register', asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254).optional().or(z.literal('')),
    mobile: mobileSchema, password: z.string().min(10, 'Use at least 10 characters.').max(128),
    preferredLanguage: z.enum(['en', 'mr', 'hi']).default('en'), role: z.enum(['farmer', 'labourer', 'machinery_provider']).default('farmer'), termsAccepted: z.literal(true),
  }).refine((v) => Boolean(v.email?.trim() || v.mobile?.trim()), { message: 'Enter an email or mobile number.', path: ['email'] });
  const body = schema.parse(req.body);
  const email = body.email?.trim().toLowerCase() || undefined;
  const mobile = normaliseMobile(body.mobile);
  const conflict = await User.findOne({ $or: [...(email ? [{ email }] : []), ...(mobile ? [{ mobile }] : [])] });
  if (conflict) throw new HttpError(409, 'An account with those details already exists. Sign in or use different details.', 'ACCOUNT_EXISTS');
  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await User.create({ name: body.name, email, mobile, passwordHash, roles: [body.role], activeRole: body.role, preferredLanguage: body.preferredLanguage, termsAcceptedAt: new Date(),
    ...(body.role === 'labourer' ? { labourerProfile: { available: false, skills: [], experienceYears: 0 } } : {}),
    ...(body.role === 'machinery_provider' ? { providerProfile: { contactPreference: 'in_app' } } : {}),
    ...(body.role === 'farmer' ? { farmerProfile: {} } : {}),
  });
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = String(user._id);
  res.status(201).json({ data: { user: publicUser(user) } });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const body = baseCredentials.parse(req.body);
  const identifier = body.identifier.trim();
  const normalised = identifier.includes('@') ? identifier.toLowerCase() : normaliseMobile(identifier);
  const user = await User.findOne(identifier.includes('@') ? { email: normalised } : { mobile: normalised }).select('+passwordHash');
  const isValid = Boolean(user && await bcrypt.compare(body.password, user.passwordHash));
  if (!isValid || !user || user.status !== 'active') throw new HttpError(401, 'The details you entered do not match an active account.', 'INVALID_CREDENTIALS');
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = String(user._id);
  res.json({ data: { user: publicUser(user) } });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  await new Promise<void>((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
  res.clearCookie(process.env.SESSION_NAME ?? 'ks.sid', { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production', path: '/' });
  res.status(204).end();
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => res.json({ data: { user: getAuthUser(req) } })));

authRouter.post('/forgot-password', asyncHandler(async (_req, _res) => {
  throw new HttpError(503, 'Account recovery is not enabled because no verified email/SMS delivery provider is configured.', 'RECOVERY_NOT_CONFIGURED');
}));
authRouter.post('/reset-password', asyncHandler(async (_req, _res) => {
  throw new HttpError(503, 'Password reset is not enabled because no verified token-delivery provider is configured.', 'RECOVERY_NOT_CONFIGURED');
}));

const roleProfileSchema = z.object({
  role: z.enum(['farmer', 'labourer', 'machinery_provider']),
  profile: z.object({
    farmName: z.string().trim().max(120).optional(),
    location: locationSchema.optional(),
    skills: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    experienceYears: z.number().min(0).max(80).optional(),
    available: z.boolean().optional(),
    bio: z.string().trim().max(800).optional(),
    serviceArea: locationSchema.optional(),
    expectedWage: wageSchema.optional(),
    preferredWorkTypes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    displayName: z.string().trim().max(120).optional(),
    description: z.string().trim().max(1000).optional(),
  }).optional().default({}),
});
authRouter.post('/activate-role', requireAuth, asyncHandler(async (req, res) => {
  const { role, profile = {} } = roleProfileSchema.parse(req.body);
  const user = await User.findById(getAuthUser(req)._id);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  if (!user.roles.includes(role)) user.roles.push(role);

  // Activating an existing role changes the active workspace without wiping saved profile data.
  // Newly added roles receive a minimal profile; optional submitted fields are patched selectively.
  if (role === 'farmer') {
    const current = user.farmerProfile?.toObject?.() ?? {};
    user.farmerProfile = { ...current, ...(profile.farmName !== undefined ? { farmName: String(profile.farmName).slice(0, 120) } : {}), ...(profile.location !== undefined ? { location: profile.location as any } : {}) } as any;
  }
  if (role === 'labourer') {
    const current = user.labourerProfile?.toObject?.() ?? {};
    const skills = Array.isArray(profile.skills) ? profile.skills.filter((x): x is string => typeof x === 'string').slice(0, 30).map((x) => x.trim().slice(0, 80)).filter(Boolean) : undefined;
    user.labourerProfile = { ...current, ...(skills !== undefined ? { skills } : {}), ...(profile.experienceYears !== undefined ? { experienceYears: Math.max(0, Math.min(80, Number(profile.experienceYears) || 0)) } : {}), ...(profile.available !== undefined ? { available: Boolean(profile.available) } : {}), ...(profile.bio !== undefined ? { bio: String(profile.bio).slice(0, 800) } : {}), ...(profile.serviceArea !== undefined ? { serviceArea: profile.serviceArea as any } : {}), ...(profile.expectedWage !== undefined ? { expectedWage: profile.expectedWage as any } : {}) } as any;
  }
  if (role === 'machinery_provider') {
    const current = user.providerProfile?.toObject?.() ?? {};
    user.providerProfile = { ...current, ...(profile.displayName !== undefined ? { displayName: String(profile.displayName).slice(0, 120) } : {}), ...(profile.description !== undefined ? { description: String(profile.description).slice(0, 1000) } : {}), ...(profile.serviceArea !== undefined ? { serviceArea: profile.serviceArea as any } : {}), contactPreference: 'in_app' } as any;
  }
  user.activeRole = role;
  await user.save();
  res.json({ data: { user: publicUser(user) } });
}));

// Switching an existing role must persist the active workspace without re-running profile activation.
authRouter.post('/active-role', requireAuth, asyncHandler(async (req, res) => {
  const { role } = z.object({ role: z.enum(['farmer', 'labourer', 'machinery_provider']) }).parse(req.body);
  const user = await User.findById(getAuthUser(req)._id);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  if (!user.roles.includes(role)) throw new HttpError(403, 'Activate this role before switching to it.', 'ROLE_NOT_ENABLED');
  user.activeRole = role;
  await user.save();
  res.json({ data: { user: publicUser(user) } });
}));

const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  preferredLanguage: z.enum(['en', 'mr', 'hi']).optional(),
  avatarUrl: z.string().url().max(1000).optional(),
  farmerProfile: z.object({ farmName: z.string().trim().max(120).optional(), location: locationSchema.optional() }).optional(),
  labourerProfile: z.object({
    skills: z.array(z.string().trim().min(1).max(80)).max(30).optional(), experienceYears: z.number().min(0).max(80).optional(),
    available: z.boolean().optional(), availabilityDates: z.array(z.coerce.date()).max(60).optional(), bio: z.string().trim().max(800).optional(),
    serviceArea: locationSchema.optional(), preferredWorkTypes: z.array(z.string().trim().min(1).max(80)).max(30).optional(), expectedWage: wageSchema.optional(),
  }).optional(),
  providerProfile: z.object({ displayName: z.string().trim().max(120).optional(), description: z.string().trim().max(1000).optional(), serviceArea: locationSchema.optional() }).optional(),
});

authRouter.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const patch = profileUpdateSchema.parse(req.body);
  const user = await User.findById(getAuthUser(req)._id);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  if (patch.name !== undefined) user.name = patch.name;
  if (patch.preferredLanguage !== undefined) user.preferredLanguage = patch.preferredLanguage;
  if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
  if (patch.farmerProfile && user.roles.includes('farmer')) user.farmerProfile = { ...(user.farmerProfile?.toObject?.() ?? {}), ...patch.farmerProfile } as any;
  if (patch.labourerProfile && user.roles.includes('labourer')) user.labourerProfile = { ...(user.labourerProfile?.toObject?.() ?? {}), ...patch.labourerProfile } as any;
  if (patch.providerProfile && user.roles.includes('machinery_provider')) user.providerProfile = { ...(user.providerProfile?.toObject?.() ?? {}), ...patch.providerProfile } as any;
  await user.save();
  res.json({ data: { user: publicUser(user) } });
}));
