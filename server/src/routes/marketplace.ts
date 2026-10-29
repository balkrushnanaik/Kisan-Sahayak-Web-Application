import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Assignment, Job, JobApplication, User, WorkRequest } from '../models/index.js';
import { getAuthUser, requireAuth, requireRoles } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { assertCanTransition, jobTransitions } from '../services/workflow.js';
import { asyncHandler, HttpError, pagination, parseObjectId, sendPage } from '../utils/http.js';

export const jobsRouter = Router();
export const labourersRouter = Router();

const locationSchema = z.object({
  village: z.string().trim().max(100).optional().default(''), taluka: z.string().trim().max(100).optional().default(''),
  district: z.string().trim().max(100).optional().default(''), state: z.string().trim().max(100).optional().default('Maharashtra'),
  point: z.object({ type: z.literal('Point').default('Point'), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }).optional(),
});
const wageSchema = z.object({ amount: z.number().min(0).max(10000000), basis: z.enum(['hour', 'worker_day', 'task']), currency: z.literal('INR').default('INR') });
const jobInputSchema = z.object({
  title: z.string().trim().min(3).max(120), category: z.string().trim().min(2).max(80), crop: z.string().trim().max(100).optional().default(''),
  description: z.string().trim().min(10).max(3000), requiredSkills: z.array(z.string().trim().min(1).max(80)).max(30).optional().default([]),
  location: locationSchema, workDate: z.coerce.date().refine((date) => date.getTime() > Date.now() - 86400000, 'Work date must not be in the past.'),
  startTime: z.string().max(20).optional().default(''), durationHours: z.number().int().min(1).max(24), workersNeeded: z.number().int().min(1).max(500), wage: wageSchema, status: z.enum(['draft', 'open']).optional().default('open'),
});

jobsRouter.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = {};
  // This is the public discovery endpoint. Private, terminal and draft states are only available through /mine.
  filter.status = { $in: ['open', 'partially_filled'] };
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (q) filter.$or = [{ title: { $regex: escapeRegex(q), $options: 'i' } }, { description: { $regex: escapeRegex(q), $options: 'i' } }, { category: { $regex: escapeRegex(q), $options: 'i' } }, { crop: { $regex: escapeRegex(q), $options: 'i' } }];
  if (req.query.category) filter.category = String(req.query.category).slice(0, 80);
  if (req.query.district) filter['location.district'] = { $regex: `^${escapeRegex(String(req.query.district).slice(0, 100))}$`, $options: 'i' };
  if (req.query.location) {
    const location = escapeRegex(String(req.query.location).trim().slice(0, 100));
    if (location) filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: ['village', 'taluka', 'district', 'state'].map((field) => ({ [`location.${field}`]: { $regex: location, $options: 'i' } })) }];
  }
  if (req.query.from || req.query.to) {
    const workDate: Record<string, Date> = {};
    if (req.query.from) workDate.$gte = new Date(String(req.query.from));
    if (req.query.to) workDate.$lte = new Date(String(req.query.to));
    filter.workDate = workDate;
  }
  if (req.query.minWage || req.query.maxWage) {
    const amount: Record<string, number> = {};
    if (req.query.minWage) amount.$gte = Math.max(0, Number(req.query.minWage) || 0);
    if (req.query.maxWage) amount.$lte = Math.max(0, Number(req.query.maxWage) || 0);
    filter['wage.amount'] = amount;
  }
  const [items, total] = await Promise.all([Job.find(filter).populate('farmer', 'name').sort({ workDate: 1, createdAt: -1 }).skip(skip).limit(limit).lean(), Job.countDocuments(filter)]);
  sendPage(res, items.map((job: any) => ({ ...job, location: { ...job.location, point: undefined } })), total, page, limit);
}));

jobsRouter.get('/mine/:id', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: parseObjectId(req.params.id, 'job id'), farmer: getAuthUser(req)._id });
  if (!job) throw new HttpError(404, 'Your job was not found.');
  res.json({ data: job });
}));

jobsRouter.get('/mine', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { farmer: getAuthUser(req)._id };
  if (req.query.status && req.query.status !== 'all') filter.status = String(req.query.status);
  const [items, total] = await Promise.all([Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Job.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));

jobsRouter.post('/', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const body = jobInputSchema.parse(req.body);
  const farmer = getAuthUser(req)._id;
  const job = await Job.create({ ...body, farmer, workersConfirmed: 0 });
  res.status(201).json({ data: job });
}));

jobsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id, 'job id');
  const job = await Job.findById(id).populate('farmer', 'name farmerProfile.farmName').lean() as any;
  if (!job) throw new HttpError(404, 'Job not found.', 'JOB_NOT_FOUND');
  if (!['open', 'partially_filled'].includes(job.status)) throw new HttpError(404, 'Job not found.', 'JOB_NOT_FOUND');
  if (job.location) job.location.point = undefined;
  res.json({ data: job });
}));

jobsRouter.patch('/:id', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id, 'job id');
  const patch = jobInputSchema.partial().omit({ status: true }).parse(req.body);
  const userId = getAuthUser(req)._id;
  const current = await Job.findById(id);
  if (!current) throw new HttpError(404, 'Job not found.');
  if (String(current.farmer) !== String(userId)) throw new HttpError(403, 'You can only edit your own jobs.');
  if (!['draft', 'open', 'partially_filled'].includes(current.status)) throw new HttpError(409, 'This job can no longer be edited.');
  if (patch.workersNeeded !== undefined && patch.workersNeeded < current.workersConfirmed) throw new HttpError(409, 'Worker requirement cannot be lower than the number already confirmed.');

  // Apply edits using a conditional atomic update. If an offer is accepted at the
  // same time, the worker-count predicate is re-evaluated against the latest document.
  const filter: Record<string, unknown> = { _id: id, farmer: userId, status: { $in: ['draft', 'open', 'partially_filled'] } };
  if (patch.workersNeeded !== undefined) filter.workersConfirmed = { $lte: patch.workersNeeded };
  const job = await Job.findOneAndUpdate(filter, { $set: patch }, { new: true, runValidators: true });
  if (!job) {
    const latest = await Job.findById(id).select('status workersConfirmed workersNeeded farmer');
    if (!latest) throw new HttpError(404, 'Job not found.');
    if (String(latest.farmer) !== String(userId)) throw new HttpError(403, 'You can only edit your own jobs.');
    if (!['draft', 'open', 'partially_filled'].includes(latest.status)) throw new HttpError(409, 'This job can no longer be edited.');
    throw new HttpError(409, 'The job changed while you were editing it. Refresh and review the worker requirement.');
  }
  res.json({ data: job });
}));

jobsRouter.post('/:id/publish', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const job = await Job.findById(parseObjectId(req.params.id, 'job id'));
  if (!job) throw new HttpError(404, 'Job not found.');
  if (String(job.farmer) !== String(getAuthUser(req)._id)) throw new HttpError(403, 'You can only publish your own jobs.');
  assertCanTransition(job.status, 'open', jobTransitions);
  job.status = 'open'; await job.save(); res.json({ data: job });
}));

jobsRouter.post('/:id/close', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => updateJobState(req, res, 'closed')));
jobsRouter.post('/:id/cancel', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => updateJobState(req, res, 'cancelled')));
async function updateJobState(req: any, res: any, nextState: 'closed' | 'cancelled') {
  const id = parseObjectId(req.params.id, 'job id');
  const userId = getAuthUser(req)._id;
  const session = await mongoose.startSession();
  let job: any;
  let applications: any[] = [];
  let requests: any[] = [];
  try {
    await session.withTransaction(async () => {
      const current = await Job.findById(id).session(session);
      if (!current) throw new HttpError(404, 'Job not found.');
      if (String(current.farmer) !== String(userId)) throw new HttpError(403, 'You can only manage your own jobs.');
      assertCanTransition(current.status, nextState, jobTransitions);
      if (nextState === 'cancelled') {
        const activeAssignments = await Assignment.countDocuments({ job: current._id, status: { $in: ['confirmed', 'in_progress'] } }).session(session);
        if (activeAssignments > 0) throw new HttpError(409, 'This job has active assignments. Cancel those assignments before cancelling the job.');
      }
      job = await Job.findOneAndUpdate(
        { _id: current._id, farmer: userId, status: current.status },
        { $set: { status: nextState } },
        { new: true, session },
      );
      if (!job) throw new HttpError(409, 'The job changed while you were updating it. Refresh and try again.');

      // Closing/cancelling the job and ending its pending marketplace activity are
      // one transaction, so no invitation can remain actionable for a closed job.
      applications = await JobApplication.find({ job: current._id, status: { $in: ['pending', 'offer_received', 'negotiation'] } }).select('_id labourer').session(session).lean();
      requests = await WorkRequest.find({ job: current._id, status: { $in: ['pending', 'negotiation'] } }).select('_id labourer').session(session).lean();
      await Promise.all([
        JobApplication.updateMany({ job: current._id, status: { $in: ['pending', 'offer_received', 'negotiation'] } }, { $set: { status: 'closed' } }, { session }),
        WorkRequest.updateMany({ job: current._id, status: { $in: ['pending', 'negotiation'] } }, { $set: { status: 'cancelled' } }, { session }),
      ]);
    });
  } finally { await session.endSession(); }
  if (!job) throw new HttpError(500, 'The job could not be updated. Please retry.');
  await Promise.all([
    ...applications.map((application) => notify(application.labourer, 'job_closed', 'Job is no longer accepting applications', `The job “${job.title}” was ${nextState}.`, 'job', job._id)),
    ...requests.map((request) => notify(request.labourer, 'offer_cancelled', 'Work offer cancelled', `The offer for “${job.title}” was cancelled because the job was ${nextState}.`, 'work_request', request._id)),
  ]);
  res.json({ data: job });
}

jobsRouter.post('/:id/applications', requireAuth, requireRoles('labourer'), asyncHandler(async (req, res) => {
  const jobId = parseObjectId(req.params.id, 'job id');
  const body = z.object({ message: z.string().trim().max(800).optional().default(''), relevantExperience: z.string().trim().max(800).optional().default('') }).parse(req.body);
  const labourerId = getAuthUser(req)._id;
  const job = await Job.findById(jobId);
  if (!job || !['open', 'partially_filled'].includes(job.status)) throw new HttpError(404, 'This job is no longer accepting applications.');
  if (String(job.farmer) === String(labourerId)) throw new HttpError(409, 'You cannot apply to your own job.');
  const labourer = await User.findById(labourerId);
  if (!labourer?.labourerProfile) throw new HttpError(409, 'Complete your labourer profile before applying.');
  if (!labourer.labourerProfile.available) throw new HttpError(409, 'Mark your profile as available before applying to work.');
  const application = await JobApplication.create({ job: job._id, farmer: job.farmer, labourer: labourerId, ...body });
  await notify(job.farmer, 'job_application', 'New job application', `${labourer.name} applied for “${job.title}”.`, 'application', application._id);
  res.status(201).json({ data: application });
}));

jobsRouter.get('/:id/applications', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const job = await Job.findById(parseObjectId(req.params.id, 'job id'));
  if (!job) throw new HttpError(404, 'Job not found.');
  if (String(job.farmer) !== String(getAuthUser(req)._id)) throw new HttpError(403, 'You can only view applications for your own jobs.');
  const { page, limit, skip } = pagination(req.query);
  const [items, total] = await Promise.all([JobApplication.find({ job: job._id }).populate('labourer', 'name labourerProfile.skills labourerProfile.experienceYears labourerProfile.serviceArea.district labourerProfile.bio').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), JobApplication.countDocuments({ job: job._id })]);
  sendPage(res, items, total, page, limit);
}));

export const applicationsRouter = Router();
applicationsRouter.get('/inbox', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { farmer: getAuthUser(req)._id };
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([JobApplication.find(filter).populate('job', 'title category location workDate durationHours wage workersNeeded workersConfirmed status').populate('labourer', 'name labourerProfile.skills labourerProfile.experienceYears labourerProfile.serviceArea.village labourerProfile.serviceArea.district labourerProfile.expectedWage labourerProfile.bio').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), JobApplication.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));

applicationsRouter.get('/mine', requireAuth, requireRoles('labourer'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter = { labourer: getAuthUser(req)._id };
  const [items, total] = await Promise.all([JobApplication.find(filter).populate('job', 'title category location.village location.district workDate wage status').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), JobApplication.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));
applicationsRouter.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id, 'application id');
  const body = z.object({ action: z.enum(['decline', 'withdraw']) }).parse(req.body);
  const application = await JobApplication.findById(id);
  if (!application) throw new HttpError(404, 'Application not found.');
  const userId = String(getAuthUser(req)._id);
  if (body.action === 'withdraw') {
    if (String(application.labourer) !== userId) throw new HttpError(403, 'You can only withdraw your own application.');
    if (!['pending', 'offer_received', 'negotiation'].includes(application.status)) throw new HttpError(409, 'This application can no longer be withdrawn.');
    // Withdraw the application and cancel its outstanding offer atomically. If an offer
    // is accepted concurrently, the work-request compare-and-set makes one transaction win.
    const session = await mongoose.startSession();
    let updatedApplication: any;
    try {
      await session.withTransaction(async () => {
        updatedApplication = await JobApplication.findOneAndUpdate(
          { _id: application._id, labourer: getAuthUser(req)._id, status: { $in: ['pending', 'offer_received', 'negotiation'] } },
          { $set: { status: 'withdrawn' } },
          { new: true, session },
        );
        if (!updatedApplication) throw new HttpError(409, 'This application was updated by another participant. Refresh and try again.');
        await WorkRequest.updateMany(
          { job: application.job, labourer: application.labourer, sourceType: 'application', status: { $in: ['pending', 'negotiation'] } },
          { $set: { status: 'cancelled' } },
          { session },
        );
      });
    } finally { await session.endSession(); }
    await notify(application.farmer, 'application_withdrawn', 'Application withdrawn', 'A labourer withdrew an application from your job.', 'application', application._id);
    return res.json({ data: updatedApplication });
  }
  if (String(application.farmer) !== userId || !getAuthUser(req).roles.includes('farmer')) throw new HttpError(403, 'Only the job owner can decline this application.');
  // Once an offer exists, the farmer must resolve it through the offer workflow first.
  if (application.status !== 'pending') throw new HttpError(409, 'This application has an active offer or is no longer pending. Resolve the offer first.');
  application.status = 'declined';
  await application.save();
  await notify(application.labourer, 'application_declined', 'Application update', 'Your application was declined by the farmer.', 'application', application._id);
  res.json({ data: application });
}));

labourersRouter.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, any> = { roles: 'labourer', status: 'active', 'labourerProfile.available': true };
  if (req.query.skill) filter['labourerProfile.skills'] = { $regex: escapeRegex(String(req.query.skill).slice(0, 80)), $options: 'i' };
  if (req.query.district) filter['labourerProfile.serviceArea.district'] = { $regex: `^${escapeRegex(String(req.query.district).slice(0, 100))}$`, $options: 'i' };
  if (req.query.location) {
    const location = escapeRegex(String(req.query.location).trim().slice(0, 100));
    if (location) filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: ['village', 'taluka', 'district', 'state'].map((field) => ({ [`labourerProfile.serviceArea.${field}`]: { $regex: location, $options: 'i' } })) }];
  }
  if (req.query.minExperience) filter['labourerProfile.experienceYears'] = { $gte: Math.max(0, Number(req.query.minExperience) || 0) };
  if (req.query.maxWage !== undefined && String(req.query.maxWage).trim() !== '') filter['labourerProfile.expectedWage.amount'] = { $lte: Math.max(0, Number(req.query.maxWage) || 0) };
  if (req.query.workDate) {
    const date = new Date(String(req.query.workDate));
    if (!Number.isNaN(date.getTime())) {
      const start = new Date(date); start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
      filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: [
        { 'labourerProfile.availabilityDates': { $elemMatch: { $gte: start, $lt: end } } },
        { 'labourerProfile.availabilityDates': { $exists: false } },
        { 'labourerProfile.availabilityDates': { $size: 0 } },
      ] }];
    }
  }
  let countFilter: Record<string, any> = filter;
  let hasGeoSearch = false;
  if (req.query.lng && req.query.lat) {
    const lng = Number(req.query.lng), lat = Number(req.query.lat), maxDistanceKm = Math.max(1, Math.min(100, Number(req.query.distanceKm ?? 25) || 25));
    if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      hasGeoSearch = true;
      filter['labourerProfile.serviceArea.point'] = { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: maxDistanceKm * 1000 } };
      // countDocuments uses an aggregation internally; use geoWithin for an equivalent radius filter.
      countFilter = { ...filter, 'labourerProfile.serviceArea.point': { $geoWithin: { $centerSphere: [[lng, lat], maxDistanceKm / 6378.1] } } };
    }
  }
  const userQuery = User.find(filter).select('name roles labourerProfile createdAt');
  if (!hasGeoSearch) userQuery.sort({ 'labourerProfile.experienceYears': -1 });
  const [users, total] = await Promise.all([userQuery.skip(skip).limit(limit).lean(), User.countDocuments(countFilter)]);
  const items = users.map((user: any) => ({ id: String(user._id), name: user.name, skills: user.labourerProfile?.skills ?? [], experienceYears: user.labourerProfile?.experienceYears ?? 0, district: user.labourerProfile?.serviceArea?.district ?? '', village: user.labourerProfile?.serviceArea?.village ?? '', bio: user.labourerProfile?.bio ?? '', expectedWage: user.labourerProfile?.expectedWage ?? null }));
  sendPage(res, items, total, page, limit);
}));

labourersRouter.get('/:id', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: parseObjectId(req.params.id, 'labourer id'), roles: 'labourer', status: 'active' }).select('name labourerProfile createdAt').lean() as any;
  if (!user) throw new HttpError(404, 'Labourer profile not found.');
  const profile = user.labourerProfile ?? {};
  res.json({ data: { id: String(user._id), name: user.name, skills: profile.skills ?? [], experienceYears: profile.experienceYears ?? 0, district: profile.serviceArea?.district ?? '', village: profile.serviceArea?.village ?? '', bio: profile.bio ?? '', expectedWage: profile.expectedWage ?? null } });
}));

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
