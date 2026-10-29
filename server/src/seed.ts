import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { User, Job, MachineryListing, JobApplication, WorkRequest, Booking, Notification } from './models/index.js';

async function seed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Refusing to seed demo records in production. Set ALLOW_DEMO_SEED=true only for an explicitly isolated demo environment.');
  await connectDatabase();
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword || demoPassword.length < 12) throw new Error('Set DEMO_PASSWORD to a password of at least 12 characters before seeding. No default credentials are used.');
  const sampleEmail = (prefix: string) => `demo.${prefix}@kisansahayak.example`;
  const hashed = await bcrypt.hash(demoPassword, 12);
  const accounts = [
    { key: 'farmer', name: 'Demo Farmer', email: sampleEmail('farmer'), roles: ['farmer'], farmerProfile: { farmName: 'Demo Farm', location: { village: 'Chas', district: 'Ahilyanagar', state: 'Maharashtra' } } },
    { key: 'worker', name: 'Demo Labourer', email: sampleEmail('worker'), roles: ['labourer'], labourerProfile: { skills: ['Sowing', 'Harvesting', 'Weeding'], experienceYears: 4, serviceArea: { village: 'Chas', district: 'Ahilyanagar', state: 'Maharashtra' }, preferredWorkTypes: ['Harvesting'], expectedWage: { amount: 550, basis: 'worker_day', currency: 'INR' }, available: true, bio: 'Demonstration account. Not a real worker.' } },
    { key: 'provider', name: 'Demo Machinery Provider', email: sampleEmail('provider'), roles: ['machinery_provider'], providerProfile: { displayName: 'Demo Equipment Rental', serviceArea: { village: 'Chas', district: 'Ahilyanagar', state: 'Maharashtra' }, description: 'Demonstration listing only.' } },
  ] as const;
  const created: Record<string, any> = {};
  for (const item of accounts) {
    let user = await User.findOne({ email: item.email });
    if (!user) user = await User.create({
      name: item.name, email: item.email, passwordHash: hashed, roles: [...item.roles], activeRole: item.roles[0],
      preferredLanguage: 'en', termsAcceptedAt: new Date(), status: 'active', demo: true,
      ...(item.key === 'farmer' ? { farmerProfile: (item as any).farmerProfile } : {}),
      ...(item.key === 'worker' ? { labourerProfile: (item as any).labourerProfile } : {}),
      ...(item.key === 'provider' ? { providerProfile: (item as any).providerProfile } : {}),
    });
    created[item.key] = user;
  }
  const farmer = created.farmer, worker = created.worker, provider = created.provider;
  let job = await Job.findOne({ farmer: farmer._id, demo: true });
  if (!job) job = await Job.create({ farmer: farmer._id, title: 'Demo soybean weeding', category: 'Weeding', crop: 'Soybean', description: 'Demonstration job for local development. This is not a real work offer.', requiredSkills: ['Weeding'], location: { village: 'Chas', district: 'Ahilyanagar', state: 'Maharashtra' }, workDate: new Date(Date.now() + 3 * 86400000), startTime: '08:00', durationHours: 6, workersNeeded: 5, workersConfirmed: 0, wage: { amount: 550, basis: 'worker_day', currency: 'INR' }, status: 'open', demo: true });
  if (!(await MachineryListing.exists({ provider: provider._id, demo: true }))) await MachineryListing.create({ provider: provider._id, category: 'tractor', name: 'Demo 45 HP Tractor', description: 'Demonstration listing only; not an actual rental offer.', photos: [], location: { village: 'Chas', district: 'Ahilyanagar', state: 'Maharashtra' }, rentalRate: { amount: 900, basis: 'hour_rental', currency: 'INR' }, minDuration: 2, operatorIncluded: true, fuelIncluded: false, available: true, status: 'active', demo: true });
  if (!(await JobApplication.exists({ job: job._id, labourer: worker._id }))) await JobApplication.create({ job: job._id, farmer: farmer._id, labourer: worker._id, message: 'Demonstration application only.', status: 'pending' });
  if (!(await WorkRequest.exists({ farmer: farmer._id, labourer: worker._id, title: 'Demo harvest assistance' }))) await WorkRequest.create({ farmer: farmer._id, labourer: worker._id, sourceType: 'direct_invitation', title: 'Demo harvest assistance', category: 'Harvesting', workDate: new Date(Date.now() + 4 * 86400000), durationHours: 6, location: { village: 'Chas', district: 'Ahilyanagar', state: 'Maharashtra' }, workersCount: 1, proposedWage: { amount: 600, basis: 'worker_day', currency: 'INR' }, status: 'pending' });
  if (!(await Booking.exists({ farmer: farmer._id, provider: provider._id }))) {
    const listing = await MachineryListing.findOne({ provider: provider._id, demo: true });
    if (listing) await Booking.create({ farmer: farmer._id, provider: provider._id, listing: listing._id, requestedStart: new Date(Date.now() + 6 * 86400000), durationHours: 3, location: { village: 'Chas', district: 'Ahilyanagar', state: 'Maharashtra' }, intendedUse: 'Demo booking only.', proposedRate: listing.rentalRate, status: 'requested' });
  }
  if (!(await Notification.exists({ recipient: farmer._id, type: 'demo_welcome' }))) await Notification.create({ recipient: farmer._id, type: 'demo_welcome', title: 'Demo data loaded', message: 'This account contains demonstration records only. No real workers or bookings are represented.' });
  console.info('Demonstration data seeded. Login identifiers: demo.farmer@kisansahayak.example, demo.worker@kisansahayak.example, demo.provider@kisansahayak.example. Password is the DEMO_PASSWORD you supplied.');
}
seed().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => disconnectDatabase());
