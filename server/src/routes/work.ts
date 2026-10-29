import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Assignment, Job, JobApplication, Notification, User, WorkRequest } from '../models/index.js';
import { getAuthUser, requireAuth, requireRoles } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { assertCanTransition, requestTransitions } from '../services/workflow.js';
import { asyncHandler, HttpError, pagination, parseObjectId, sendPage } from '../utils/http.js';

export const workRequestsRouter = Router();
export const assignmentsRouter = Router();

const locationSchema = z.object({ village: z.string().trim().max(100).optional().default(''), taluka: z.string().trim().max(100).optional().default(''), district: z.string().trim().max(100).optional().default(''), state: z.string().trim().max(100).optional().default('Maharashtra'), point: z.object({ type: z.literal('Point').default('Point'), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }).optional() });
const wageSchema = z.object({ amount: z.number().min(0).max(10000000), basis: z.enum(['hour', 'worker_day', 'task']), currency: z.literal('INR').default('INR') });
const offerSchema = z.object({ labourerId: z.string().regex(/^[a-f\d]{24}$/i), jobId: z.string().regex(/^[a-f\d]{24}$/i).optional(), title: z.string().trim().min(3).max(120), category: z.string().trim().min(2).max(80), workDate: z.coerce.date().refine((date) => date.getTime() > Date.now() - 86400000), durationHours: z.number().int().min(1).max(24), location: locationSchema, workersCount: z.number().int().min(1).max(500).default(1), proposedWage: wageSchema, note: z.string().trim().max(500).optional().default('') });

workRequestsRouter.post('/', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const body = offerSchema.parse(req.body);
  const farmerId = getAuthUser(req)._id;
  const labourer = await User.findOne({ _id: body.labourerId, roles: 'labourer', status: 'active' });
  if (!labourer) throw new HttpError(404, 'Labourer profile not found.');
  if (String(labourer._id) === String(farmerId)) throw new HttpError(409, 'You cannot invite your own account.');
  if (!labourer.labourerProfile?.available) throw new HttpError(409, 'This labourer is not currently marked as available.');
  let job: any;
  let existingApplication: any;
  if (body.jobId) {
    job = await Job.findById(body.jobId);
    if (!job || String(job.farmer) !== String(farmerId)) throw new HttpError(404, 'Your job was not found.');
    if (!['open', 'partially_filled'].includes(job.status)) throw new HttpError(409, 'This job is not accepting new workers.');
    existingApplication = await JobApplication.findOne({ job: job._id, labourer: labourer._id });
    if (existingApplication?.status === 'confirmed') throw new HttpError(409, 'This labourer is already confirmed for the job.');
    const activeRequest = await WorkRequest.findOne({ job: job._id, labourer: labourer._id, status: { $in: ['pending', 'negotiation', 'accepted'] } }).select('_id');
    if (activeRequest) throw new HttpError(409, 'There is already an active offer for this labourer and job.');
  }
  const sourceType = existingApplication && ['pending', 'offer_received', 'negotiation'].includes(existingApplication.status) ? 'application' : 'direct_invitation';
  const workRequest = await WorkRequest.create({ farmer: farmerId, labourer: labourer._id, job: job?._id, sourceType, title: body.title, category: body.category, workDate: body.workDate, durationHours: body.durationHours, location: body.location, workersCount: body.workersCount, proposedWage: body.proposedWage, proposalHistory: body.note ? [{ proposer: farmerId, wage: body.proposedWage, note: body.note }] : [] });
  if (sourceType === 'application' && job) await JobApplication.updateOne({ job: job._id, labourer: labourer._id, status: 'pending' }, { $set: { status: 'offer_received' } });
  await notify(labourer._id, 'work_invitation', 'A farmer sent you a work offer', `${getAuthUser(req).name} invited you for “${body.title}”.`, 'work_request', workRequest._id);
  res.status(201).json({ data: workRequest });
}));

workRequestsRouter.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const as = String(req.query.as ?? '');
  let filter: Record<string, unknown>;
  if (as === 'farmer') {
    if (!user.roles.includes('farmer')) throw new HttpError(403, 'Farmer role required.');
    filter = { farmer: user._id };
  } else if (as === 'labourer') {
    if (!user.roles.includes('labourer')) throw new HttpError(403, 'Labourer role required.');
    filter = { labourer: user._id };
  } else if (user.roles.includes('labourer')) filter = { labourer: user._id };
  else filter = { farmer: user._id };
  const { page, limit, skip } = pagination(req.query);
  const [items, total] = await Promise.all([WorkRequest.find(filter).populate('farmer', 'name').populate('labourer', 'name').populate('job', 'title status').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), WorkRequest.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));

workRequestsRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const request = await WorkRequest.findById(parseObjectId(req.params.id, 'work request id'));
  if (!request) throw new HttpError(404, 'Work request not found.');
  const id = String(getAuthUser(req)._id);
  // Authorize against raw ObjectId references before populating them for display.
  if (String(request.farmer) !== id && String(request.labourer) !== id) throw new HttpError(403, 'You cannot view this work request.');
  await request.populate([{ path: 'farmer', select: 'name' }, { path: 'labourer', select: 'name' }, { path: 'job', select: 'title status' }]);
  res.json({ data: request });
}));

workRequestsRouter.post('/:id/respond', requireAuth, asyncHandler(async (req, res) => {
  const { action } = z.object({ action: z.enum(['accept', 'decline', 'accept_counter', 'decline_counter', 'cancel']) }).parse(req.body);
  const workRequest = await WorkRequest.findById(parseObjectId(req.params.id, 'work request id'));
  if (!workRequest) throw new HttpError(404, 'Work request not found.');
  const user = getAuthUser(req), userId = String(user._id);
  const isFarmer = String(workRequest.farmer) === userId && user.roles.includes('farmer');
  const isLabourer = String(workRequest.labourer) === userId && user.roles.includes('labourer');
  if (!isFarmer && !isLabourer) throw new HttpError(403, 'You are not a participant in this offer.');
  const currentStatus = workRequest.status;
  if (action === 'cancel') {
    if (!isFarmer || !['pending', 'negotiation'].includes(currentStatus)) throw new HttpError(403, 'Only the farmer can cancel an offer that has not been accepted.');
    assertCanTransition(currentStatus, 'cancelled', requestTransitions);
    workRequest.status = 'cancelled'; await workRequest.save();
    if (workRequest.job && workRequest.sourceType === 'application') await JobApplication.updateOne({ job: workRequest.job, labourer: workRequest.labourer, status: { $in: ['offer_received', 'negotiation'] } }, { $set: { status: 'pending' } });
    await notify(workRequest.labourer, 'offer_cancelled', 'Work offer cancelled', `The offer for “${workRequest.title}” was cancelled.`, 'work_request', workRequest._id);
    return res.json({ data: workRequest });
  }
  if (action === 'decline' || action === 'decline_counter') {
    if (action === 'decline_counter' && currentStatus !== 'negotiation') throw new HttpError(409, 'There is no counter-offer to decline.');
    if (action === 'decline_counter' && (!workRequest.proposalHistory.length || String(workRequest.proposalHistory[workRequest.proposalHistory.length - 1]?.proposer) === userId)) throw new HttpError(409, 'You cannot decline your own counter-offer.');
    assertCanTransition(currentStatus, 'declined', requestTransitions);
    workRequest.status = 'declined'; await workRequest.save();
    if (workRequest.job && workRequest.sourceType === 'application') await JobApplication.updateOne({ job: workRequest.job, labourer: workRequest.labourer, status: { $in: ['offer_received', 'negotiation'] } }, { $set: { status: 'declined' } });
    await notify(isFarmer ? workRequest.labourer : workRequest.farmer, 'offer_declined', 'Work offer declined', `The offer for “${workRequest.title}” was declined.`, 'work_request', workRequest._id);
    return res.json({ data: workRequest });
  }
  let finalWage: any;
  if (action === 'accept') {
    if (!isLabourer || currentStatus !== 'pending') throw new HttpError(409, 'Only the invited labourer can accept the original offer.');
    finalWage = workRequest.proposedWage;
  } else {
    if (currentStatus !== 'negotiation' || !workRequest.proposalHistory.length) throw new HttpError(409, 'There is no counter-offer ready to accept.');
    const latest = workRequest.proposalHistory[workRequest.proposalHistory.length - 1]!;
    if (String(latest.proposer) === userId) throw new HttpError(409, 'The other participant must respond to your counter-offer.');
    finalWage = latest.wage;
  }
  // Keep offer acceptance, worker-slot reservation and assignment creation in one transaction.
  // MongoDB must run as a replica set for this operation (configured in docker-compose.yml).
  const session = await mongoose.startSession();
  let latestRequest: any;
  let assignment: any;
  try {
    await session.withTransaction(async () => {
      latestRequest = await WorkRequest.findOneAndUpdate(
        { _id: workRequest._id, status: currentStatus },
        { $set: { status: 'accepted', agreedWage: finalWage } },
        { new: true, session },
      );
      if (!latestRequest) throw new HttpError(409, 'This offer was updated by another participant. Refresh and try again.');

      if (workRequest.job) {
        const job = await Job.findOneAndUpdate(
          { _id: workRequest.job, status: { $in: ['open', 'partially_filled'] }, $expr: { $lt: ['$workersConfirmed', '$workersNeeded'] } },
          { $inc: { workersConfirmed: 1 } },
          { new: true, session },
        );
        if (!job) throw new HttpError(409, 'All worker positions are filled or the job is no longer open.');
        job.status = job.workersConfirmed >= job.workersNeeded ? 'filled' : 'partially_filled';
        await job.save({ session });
        if (workRequest.sourceType === 'application') {
          await JobApplication.updateOne(
            { job: workRequest.job, labourer: workRequest.labourer, status: { $in: ['pending', 'offer_received', 'negotiation'] } },
            { $set: { status: 'confirmed' } },
            { session },
          );
        }
      }

      const created = await Assignment.create([{
        farmer: workRequest.farmer, labourer: workRequest.labourer, job: workRequest.job,
        workRequest: workRequest._id, title: workRequest.title, workDate: workRequest.workDate,
        location: workRequest.location, agreedWage: finalWage, status: 'confirmed',
      }], { session });
      assignment = created[0];
    });
  } finally {
    await session.endSession();
  }
  if (!latestRequest || !assignment) throw new HttpError(500, 'The offer could not be confirmed. Please retry.');
  await Promise.all([
    notify(workRequest.farmer, 'assignment_confirmed', 'Worker confirmed', `Terms for “${workRequest.title}” have been accepted.`, 'assignment', assignment._id),
    notify(workRequest.labourer, 'assignment_confirmed', 'Work confirmed', `Your assignment for “${workRequest.title}” is confirmed.`, 'assignment', assignment._id),
  ]);
  return res.json({ data: { workRequest: latestRequest, assignment } });
}));

workRequestsRouter.post('/:id/counter-offer', requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ wage: wageSchema, note: z.string().trim().max(500).optional().default('') }).parse(req.body);
  const request = await WorkRequest.findById(parseObjectId(req.params.id, 'work request id'));
  if (!request) throw new HttpError(404, 'Work request not found.');
  const user = getAuthUser(req), userId = String(user._id);
  const isFarmer = String(request.farmer) === userId && user.roles.includes('farmer');
  const isLabourer = String(request.labourer) === userId && user.roles.includes('labourer');
  if (!isFarmer && !isLabourer) throw new HttpError(403, 'You are not a participant in this offer.');
  if (!['pending', 'negotiation'].includes(request.status)) throw new HttpError(409, 'This offer is no longer open for negotiation.');
  if (request.proposalHistory.length && String(request.proposalHistory[request.proposalHistory.length - 1]?.proposer) === userId) throw new HttpError(409, 'Wait for the other participant to respond before proposing again.');
  request.proposalHistory.push({ proposer: user._id as any, wage: body.wage, note: body.note, createdAt: new Date() } as any);
  request.status = 'negotiation';
  await request.save();
  if (request.job && request.sourceType === 'application') await JobApplication.updateOne({ job: request.job, labourer: request.labourer, status: { $in: ['pending', 'offer_received', 'negotiation'] } }, { $set: { status: 'negotiation' } });
  await notify(isFarmer ? request.labourer : request.farmer, 'counter_offer', 'A new counter-offer arrived', `New terms were proposed for “${request.title}”.`, 'work_request', request._id);
  res.json({ data: request });
}));

assignmentsRouter.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const filter = { $or: [{ farmer: user._id }, { labourer: user._id }] };
  const { page, limit, skip } = pagination(req.query);
  const [items, total] = await Promise.all([Assignment.find(filter).populate('farmer', 'name').populate('labourer', 'name').populate('job', 'title').sort({ workDate: -1 }).skip(skip).limit(limit).lean(), Assignment.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));
assignmentsRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(parseObjectId(req.params.id, 'assignment id'));
  if (!assignment) throw new HttpError(404, 'Assignment not found.');
  const userId = String(getAuthUser(req)._id);
  // Check participant IDs before populating display names.
  if (String(assignment.farmer) !== userId && String(assignment.labourer) !== userId) throw new HttpError(403, 'You cannot view this assignment.');
  await assignment.populate([{ path: 'farmer', select: 'name' }, { path: 'labourer', select: 'name' }, { path: 'job', select: 'title' }]);
  res.json({ data: assignment });
}));
assignmentsRouter.post('/:id/:action', requireAuth, asyncHandler(async (req, res) => {
  const action = z.enum(['start', 'complete', 'cancel']).parse(req.params.action);
  const body = z.object({ note: z.string().trim().max(1000).optional().default('') }).parse(req.body ?? {});
  const assignment = await Assignment.findById(parseObjectId(req.params.id, 'assignment id'));
  if (!assignment) throw new HttpError(404, 'Assignment not found.');
  const user = getAuthUser(req), id = String(user._id), isFarmer = String(assignment.farmer) === id, isWorker = String(assignment.labourer) === id;
  if (!isFarmer && !isWorker) throw new HttpError(403, 'You cannot update this assignment.');
  const next = action === 'start' ? 'in_progress' : action === 'complete' ? 'completed' : 'cancelled';
  if (action === 'start' && !isFarmer) throw new HttpError(403, 'Only the farmer can mark work as started.');
  if (action === 'complete' && !isFarmer && !isWorker) throw new HttpError(403, 'Only assignment participants can complete work.');
  if (action === 'cancel' && assignment.status !== 'confirmed') throw new HttpError(409, 'Only a confirmed assignment can be cancelled.');
  if (action === 'cancel' && !body.note.trim()) throw new HttpError(422, 'Please provide a cancellation reason.');
  const transitions: Record<string, string[]> = { confirmed: ['in_progress', 'cancelled'], in_progress: ['completed', 'cancelled'], completed: [], cancelled: [], disputed: [] };
  assertCanTransition(assignment.status, next, transitions);
  const session = await mongoose.startSession();
  let updatedAssignment: any;
  try {
    await session.withTransaction(async () => {
      const update: Record<string, unknown> = { status: next };
      if (action === 'complete') update.completionNote = body.note;
      if (action === 'cancel') update.cancellationReason = body.note;
      updatedAssignment = await Assignment.findOneAndUpdate(
        { _id: assignment._id, status: assignment.status },
        { $set: update },
        { new: true, session },
      );
      if (!updatedAssignment) throw new HttpError(409, 'This assignment was updated by another participant. Refresh and try again.');
      if (assignment.job && action === 'cancel') {
        const job = await Job.findOneAndUpdate(
          { _id: assignment.job, workersConfirmed: { $gt: 0 } },
          { $inc: { workersConfirmed: -1 } },
          { new: true, session },
        );
        if (!job) throw new HttpError(409, 'The linked job worker count could not be reconciled. No changes were saved.');
        if (['filled', 'in_progress'].includes(job.status) && job.workersConfirmed < job.workersNeeded) {
          job.status = job.workersConfirmed > 0 ? 'partially_filled' : 'open';
          await job.save({ session });
        }
      }
      if (assignment.job && action === 'start') {
        const job = await Job.findById(assignment.job).session(session);
        // Keep a partially-filled job discoverable until every required worker slot is filled.
        if (job?.status === 'filled') {
          job.status = 'in_progress';
          await job.save({ session });
        }
      }
      if (assignment.job && action === 'complete') {
        const job = await Job.findById(assignment.job).session(session);
        if (job && ['filled', 'in_progress'].includes(job.status) && job.workersConfirmed >= job.workersNeeded) {
          const remainingAssignments = await Assignment.countDocuments({ job: job._id, status: { $in: ['confirmed', 'in_progress'] } }).session(session);
          if (remainingAssignments === 0) {
            job.status = 'completed';
            await job.save({ session });
          }
        }
      }
    });
  } finally {
    await session.endSession();
  }
  await notify(isFarmer ? assignment.labourer : assignment.farmer, `assignment_${next}`, 'Assignment updated', `The assignment “${assignment.title}” is now ${next.replace('_', ' ')}.`, 'assignment', assignment._id);
  res.json({ data: updatedAssignment });
}));
