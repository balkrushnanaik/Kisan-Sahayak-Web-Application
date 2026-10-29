import { Router } from 'express';
import { z } from 'zod';
import { AdminAuditLog, Assignment, Booking, Job, JobApplication, MachineryListing, Notification, Report, Review, User } from '../models/index.js';
import { getAuthUser, requireAuth, requireRoles } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { asyncHandler, HttpError, pagination, parseObjectId, sendPage } from '../utils/http.js';

export const notificationsRouter = Router();
export const reviewsRouter = Router();
export const reportsRouter = Router();
export const dashboardRouter = Router();
export const adminRouter = Router();

notificationsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = getAuthUser(req)._id;
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { recipient: userId };
  if (req.query.read === 'false') filter.readAt = { $exists: false };
  if (req.query.read === 'true') filter.readAt = { $exists: true };
  const [items, total, unread] = await Promise.all([Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Notification.countDocuments(filter), Notification.countDocuments({ recipient: userId, readAt: { $exists: false } })]);
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, unreadCount: unread });
}));
notificationsRouter.patch('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate({ _id: parseObjectId(req.params.id, 'notification id'), recipient: getAuthUser(req)._id }, { $set: { readAt: new Date() } }, { new: true });
  if (!notification) throw new HttpError(404, 'Notification not found.');
  res.json({ data: notification });
}));
notificationsRouter.post('/read-all', requireAuth, asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: getAuthUser(req)._id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  res.status(204).end();
}));

reviewsRouter.post('/', requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ assignmentId: z.string().regex(/^[a-f\d]{24}$/i).optional(), bookingId: z.string().regex(/^[a-f\d]{24}$/i).optional(), rating: z.number().int().min(1).max(5), text: z.string().trim().max(1000).optional().default('') }).refine((v) => Boolean(v.assignmentId) !== Boolean(v.bookingId), 'Choose one completed assignment or booking.').parse(req.body);
  const reviewerId = getAuthUser(req)._id;
  const existingReview = await Review.findOne({ reviewer: reviewerId, ...(body.assignmentId ? { assignment: body.assignmentId } : { booking: body.bookingId }) }).select('_id');
  if (existingReview) throw new HttpError(409, 'You have already reviewed this completed interaction.');
  let revieweeId: any;
  if (body.assignmentId) {
    const assignment = await Assignment.findById(body.assignmentId);
    if (!assignment || assignment.status !== 'completed') throw new HttpError(409, 'Reviews are available only after work is completed.');
    if (String(assignment.farmer) === String(reviewerId)) revieweeId = assignment.labourer;
    else if (String(assignment.labourer) === String(reviewerId)) revieweeId = assignment.farmer;
    else throw new HttpError(403, 'You are not a participant in this assignment.');
  } else {
    const booking = await Booking.findById(body.bookingId!);
    if (!booking || booking.status !== 'completed') throw new HttpError(409, 'Reviews are available only after a booking is completed.');
    if (String(booking.farmer) === String(reviewerId)) revieweeId = booking.provider;
    else if (String(booking.provider) === String(reviewerId)) revieweeId = booking.farmer;
    else throw new HttpError(403, 'You are not a participant in this booking.');
  }
  const review = await Review.create({ reviewer: reviewerId, reviewee: revieweeId, assignment: body.assignmentId, booking: body.bookingId, rating: body.rating, text: body.text });
  res.status(201).json({ data: review });
}));

reportsRouter.post('/', requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ reportedUserId: z.string().regex(/^[a-f\d]{24}$/i).optional(), listingId: z.string().regex(/^[a-f\d]{24}$/i).optional(), reason: z.enum(['unsafe_behaviour', 'misleading_listing', 'abuse', 'spam', 'other']), details: z.string().trim().max(2000).optional().default('') }).refine((v) => Boolean(v.reportedUserId) !== Boolean(v.listingId), 'Report exactly one user or listing at a time.').parse(req.body);
  if (body.reportedUserId && String(body.reportedUserId) === String(getAuthUser(req)._id)) throw new HttpError(422, 'You cannot report your own account.');
  if (body.reportedUserId && !(await User.exists({ _id: body.reportedUserId }))) throw new HttpError(404, 'Reported user not found.');
  if (body.listingId && !(await MachineryListing.exists({ _id: body.listingId }))) throw new HttpError(404, 'Reported listing not found.');
  const report = await Report.create({ reporter: getAuthUser(req)._id, reportedUser: body.reportedUserId, listing: body.listingId, reason: body.reason, details: body.details });
  res.status(201).json({ data: report });
}));

// Role-aware dashboards query current records; no dashboard count is hardcoded.
dashboardRouter.get('/summary', requireAuth, asyncHandler(async (req, res) => {
  const user = getAuthUser(req), id = user._id;
  const summary: Record<string, unknown> = {};
  if (user.roles.includes('farmer')) {
    const jobs = await Job.find({ farmer: id }).select('_id status workersConfirmed workersNeeded').lean();
    const jobIds = jobs.map((x) => x._id);
    const [applications, pendingInvites, assignments, unreadNotifications, listings] = await Promise.all([
      JobApplication.countDocuments({ farmer: id, status: { $in: ['pending', 'offer_received', 'negotiation'] } }),
      (await import('../models/index.js')).WorkRequest.countDocuments({ farmer: id, status: { $in: ['pending', 'negotiation'] } }),
      Assignment.countDocuments({ farmer: id, status: { $in: ['confirmed', 'in_progress'] } }),
      Notification.countDocuments({ recipient: id, readAt: { $exists: false } }),
      MachineryListing.countDocuments({ status: 'active', available: true }),
    ]);
    summary.farmer = { openJobs: jobs.filter((j) => ['open', 'partially_filled'].includes(j.status)).length, applications, pendingInvitations: pendingInvites, confirmedAssignments: assignments, unreadNotifications, ownJobCount: jobs.length, machineryListingsAvailable: listings, recentJobIds: jobIds.slice(-5).map(String) };
  }
  if (user.roles.includes('labourer')) {
    const [applications, invitations, assignments, completed, unreadNotifications] = await Promise.all([
      JobApplication.countDocuments({ labourer: id, status: { $in: ['pending', 'offer_received', 'negotiation'] } }),
      (await import('../models/index.js')).WorkRequest.countDocuments({ labourer: id, status: { $in: ['pending', 'negotiation'] } }),
      Assignment.countDocuments({ labourer: id, status: { $in: ['confirmed', 'in_progress'] } }),
      Assignment.countDocuments({ labourer: id, status: 'completed' }),
      Notification.countDocuments({ recipient: id, readAt: { $exists: false } }),
    ]);
    summary.labourer = { applications, invitations, assignments, completed, unreadNotifications, available: Boolean((user as any).labourerProfile?.available) };
  }
  if (user.roles.includes('machinery_provider')) {
    const [activeListings, pendingBookings, upcomingBookings, completedBookings] = await Promise.all([
      MachineryListing.countDocuments({ provider: id, status: 'active' }), Booking.countDocuments({ provider: id, status: { $in: ['requested', 'negotiation'] } }), Booking.countDocuments({ provider: id, status: 'confirmed', requestedStart: { $gte: new Date() } }), Booking.countDocuments({ provider: id, status: 'completed' }),
    ]);
    summary.machineryProvider = { activeListings, pendingBookings, upcomingBookings, completedBookings };
  }
  res.json({ data: summary });
}));

adminRouter.use(requireAuth, requireRoles('admin'));
adminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const [users, activeUsers, jobs, openJobs, listings, activeListings, openReports, bookings, assignments] = await Promise.all([
    User.countDocuments(), User.countDocuments({ status: 'active' }), Job.countDocuments(), Job.countDocuments({ status: { $in: ['open', 'partially_filled'] } }), MachineryListing.countDocuments(), MachineryListing.countDocuments({ status: 'active' }), Report.countDocuments({ status: { $in: ['open', 'investigating'] } }), Booking.countDocuments(), Assignment.countDocuments(),
  ]);
  res.json({ data: { users, activeUsers, jobs, openJobs, listings, activeListings, openReports, bookings, assignments } });
}));
adminRouter.get('/users', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query), q = String(req.query.q ?? '').trim().slice(0, 100);
  const filter: Record<string, unknown> = {};
  if (q) filter.$or = [{ name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([User.find(filter).select('-passwordHash -mobile').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), User.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));
adminRouter.get('/listings', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);
  else filter.status = { $ne: 'removed' };
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { description: { $regex: escaped, $options: 'i' } }];
  }
  const [items, total] = await Promise.all([
    MachineryListing.find(filter).populate('provider', 'name providerProfile.displayName').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    MachineryListing.countDocuments(filter),
  ]);
  sendPage(res, items.map((item: any) => ({ ...item, location: { ...item.location, point: undefined } })), total, page, limit);
}));

adminRouter.get('/reports', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query), filter = req.query.status ? { status: String(req.query.status) } : { status: { $in: ['open', 'investigating'] } };
  const [items, total] = await Promise.all([Report.find(filter).populate('reporter', 'name').populate('reportedUser', 'name').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(), Report.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));
adminRouter.patch('/reports/:id', asyncHandler(async (req, res) => {
  const { status, resolution } = z.object({ status: z.enum(['investigating', 'resolved', 'dismissed']), resolution: z.string().trim().max(1000).optional().default('') }).parse(req.body);
  const report = await Report.findById(parseObjectId(req.params.id, 'report id'));
  if (!report) throw new HttpError(404, 'Report not found.');
  report.status = status; report.resolution = resolution; report.resolvedBy = getAuthUser(req)._id as any; await report.save();
  await AdminAuditLog.create({ admin: getAuthUser(req)._id, action: 'report.update', entityType: 'Report', entityId: report._id, reason: resolution });
  await notify(report.reporter, 'report_update', 'Report status updated', `Your report is now marked ${status}.`, 'report', report._id);
  res.json({ data: report });
}));
adminRouter.patch('/users/:id/status', asyncHandler(async (req, res) => {
  const { status, reason } = z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(3).max(1000) }).parse(req.body);
  const user = await User.findById(parseObjectId(req.params.id, 'user id'));
  if (!user) throw new HttpError(404, 'User not found.');
  if (String(user._id) === String(getAuthUser(req)._id)) throw new HttpError(409, 'Administrators cannot suspend their own account.');
  user.status = status; await user.save();
  await AdminAuditLog.create({ admin: getAuthUser(req)._id, action: `user.${status}`, entityType: 'User', entityId: user._id, reason });
  res.json({ data: { id: String(user._id), status: user.status } });
}));
adminRouter.patch('/listings/:id/moderate', asyncHandler(async (req, res) => {
  const { status, reason } = z.object({ status: z.enum(['active', 'paused', 'removed']), reason: z.string().trim().min(3).max(1000) }).parse(req.body);
  const listing = await MachineryListing.findById(parseObjectId(req.params.id, 'listing id'));
  if (!listing) throw new HttpError(404, 'Machinery listing not found.');
  listing.status = status; if (status !== 'active') listing.available = false; await listing.save();
  await AdminAuditLog.create({ admin: getAuthUser(req)._id, action: `listing.${status}`, entityType: 'MachineryListing', entityId: listing._id, reason });
  res.json({ data: listing });
}));
adminRouter.get('/audit', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const [items, total] = await Promise.all([AdminAuditLog.find().populate('admin', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), AdminAuditLog.countDocuments()]);
  sendPage(res, items, total, page, limit);
}));
