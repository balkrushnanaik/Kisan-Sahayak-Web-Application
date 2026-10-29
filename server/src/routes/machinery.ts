import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Booking, MachineryListing, Notification, User } from '../models/index.js';
import { getAuthUser, requireAuth, requireRoles } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { assertCanTransition, bookingTransitions } from '../services/workflow.js';
import { asyncHandler, HttpError, pagination, parseObjectId, sendPage } from '../utils/http.js';

export const machineryRouter = Router();
export const bookingsRouter = Router();

const locationSchema = z.object({ village: z.string().trim().max(100).optional().default(''), taluka: z.string().trim().max(100).optional().default(''), district: z.string().trim().max(100).optional().default(''), state: z.string().trim().max(100).optional().default('Maharashtra'), point: z.object({ type: z.literal('Point').default('Point'), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }).optional() });
const rateSchema = z.object({ amount: z.number().min(0).max(10000000), basis: z.enum(['hour_rental', 'day_rental', 'booking', 'acre']), currency: z.literal('INR').default('INR') });
const listingInput = z.object({ category: z.enum(['tractor', 'rotavator', 'harvester', 'seed_drill', 'sprayer', 'other']), name: z.string().trim().min(2).max(120), model: z.string().trim().max(120).optional().default(''), description: z.string().trim().max(2000).optional().default(''), photos: z.array(z.string().url().max(1000)).max(10).optional().default([]), specifications: z.record(z.string().max(100)).optional().default({}), location: locationSchema, rentalRate: rateSchema, minDuration: z.number().int().min(1).max(720).default(1), operatorIncluded: z.boolean().default(false), fuelIncluded: z.boolean().default(false), transportDetails: z.string().trim().max(500).optional().default(''), available: z.boolean().default(true), status: z.enum(['active', 'paused']).optional().default('active') });

machineryRouter.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, any> = { status: 'active', available: true };
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.q) filter.$or = [{ name: { $regex: escapeRegex(String(req.query.q).slice(0, 100)), $options: 'i' } }, { description: { $regex: escapeRegex(String(req.query.q).slice(0, 100)), $options: 'i' } }];
  if (req.query.district) filter['location.district'] = { $regex: `^${escapeRegex(String(req.query.district).slice(0, 100))}$`, $options: 'i' };
  if (req.query.location) {
    const location = escapeRegex(String(req.query.location).trim().slice(0, 100));
    if (location) filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: ['village', 'taluka', 'district', 'state'].map((field) => ({ [`location.${field}`]: { $regex: location, $options: 'i' } })) }];
  }
  if (req.query.maxRate) filter['rentalRate.amount'] = { $lte: Math.max(0, Number(req.query.maxRate) || 0) };
  let countFilter: Record<string, any> = filter;
  let hasGeoSearch = false;
  if (req.query.lng && req.query.lat) {
    const lng = Number(req.query.lng), lat = Number(req.query.lat), distanceKm = Math.max(1, Math.min(150, Number(req.query.distanceKm ?? 30) || 30));
    if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      hasGeoSearch = true;
      filter['location.point'] = { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: distanceKm * 1000 } };
      countFilter = { ...filter, 'location.point': { $geoWithin: { $centerSphere: [[lng, lat], distanceKm / 6378.1] } } };
    }
  }
  const listingQuery = MachineryListing.find(filter).populate('provider', 'name providerProfile.displayName');
  if (!hasGeoSearch) listingQuery.sort({ createdAt: -1 });
  const [items, total] = await Promise.all([listingQuery.skip(skip).limit(limit).lean(), MachineryListing.countDocuments(countFilter)]);
  sendPage(res, items.map((item: any) => ({ ...item, location: { ...item.location, point: undefined } })), total, page, limit);
}));

machineryRouter.post('/', requireAuth, requireRoles('machinery_provider'), asyncHandler(async (req, res) => {
  const body = listingInput.parse(req.body);
  const listing = await MachineryListing.create({ ...body, provider: getAuthUser(req)._id });
  res.status(201).json({ data: listing });
}));

machineryRouter.get('/mine', requireAuth, requireRoles('machinery_provider'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query), filter = { provider: getAuthUser(req)._id };
  const [items, total] = await Promise.all([MachineryListing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), MachineryListing.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));

machineryRouter.get('/mine/:id', requireAuth, requireRoles('machinery_provider'), asyncHandler(async (req, res) => {
  const listing = await MachineryListing.findOne({ _id: parseObjectId(req.params.id, 'listing id'), provider: getAuthUser(req)._id }).lean();
  if (!listing) throw new HttpError(404, 'Your machinery listing was not found.');
  res.json({ data: { ...listing, location: { ...listing.location, point: undefined } } });
}));

machineryRouter.get('/:id', asyncHandler(async (req, res) => {
  const listing = await MachineryListing.findById(parseObjectId(req.params.id, 'listing id')).populate('provider', 'name providerProfile.displayName providerProfile.description').lean() as any;
  if (!listing || listing.status !== 'active') throw new HttpError(404, 'Machinery listing not found.');
  listing.location = { ...listing.location, point: undefined };
  res.json({ data: listing });
}));

machineryRouter.patch('/:id', requireAuth, requireRoles('machinery_provider'), asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id, 'listing id');
  const patch = listingInput.partial().parse(req.body);
  const listing = await MachineryListing.findById(id);
  if (!listing) throw new HttpError(404, 'Machinery listing not found.');
  if (String(listing.provider) !== String(getAuthUser(req)._id)) throw new HttpError(403, 'You can only edit your own listings.');
  listing.set(patch);
  await listing.save();
  res.json({ data: listing });
}));

machineryRouter.delete('/:id', requireAuth, requireRoles('machinery_provider'), asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id, 'listing id');
  const listing = await MachineryListing.findById(id);
  if (!listing) throw new HttpError(404, 'Machinery listing not found.');
  if (String(listing.provider) !== String(getAuthUser(req)._id)) throw new HttpError(403, 'You can only remove your own listings.');
  const active = await Booking.exists({ listing: id, status: { $in: ['requested', 'negotiation', 'confirmed'] } });
  if (active) throw new HttpError(409, 'This listing has active bookings. Pause it instead of deleting it.');
  listing.status = 'removed'; listing.available = false; await listing.save();
  res.status(204).end();
}));

const bookingInput = z.object({ listingId: z.string().regex(/^[a-f\d]{24}$/i), requestedStart: z.coerce.date().refine((date) => date.getTime() > Date.now() - 86400000), durationHours: z.number().int().min(1).max(24 * 30), location: locationSchema, intendedUse: z.string().trim().max(1000).optional().default('') });
bookingsRouter.post('/', requireAuth, requireRoles('farmer'), asyncHandler(async (req, res) => {
  const body = bookingInput.parse(req.body);
  const listing = await MachineryListing.findOne({ _id: body.listingId, status: 'active', available: true });
  if (!listing) throw new HttpError(404, 'This equipment is not currently available.');
  if (String(listing.provider) === String(getAuthUser(req)._id)) throw new HttpError(409, 'You cannot book your own machinery.');
  const booking = await Booking.create({ farmer: getAuthUser(req)._id, provider: listing.provider, listing: listing._id, requestedStart: body.requestedStart, durationHours: body.durationHours, location: body.location, intendedUse: body.intendedUse, proposedRate: listing.rentalRate });
  await notify(listing.provider, 'booking_received', 'New machinery booking request', `A farmer requested “${listing.name}”.`, 'booking', booking._id);
  res.status(201).json({ data: booking });
}));

bookingsRouter.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const user = getAuthUser(req), as = String(req.query.as ?? '');
  let filter: any;
  if (as === 'provider') {
    if (!user.roles.includes('machinery_provider')) throw new HttpError(403, 'Machinery provider role required.');
    filter = { provider: user._id };
  } else if (as === 'farmer') {
    if (!user.roles.includes('farmer')) throw new HttpError(403, 'Farmer role required.');
    filter = { farmer: user._id };
  } else {
    filter = user.roles.includes('farmer') ? { farmer: user._id } : { provider: user._id };
  }
  const { page, limit, skip } = pagination(req.query);
  const [items, total] = await Promise.all([Booking.find(filter).populate('listing', 'name category photos rentalRate').populate('farmer', 'name').populate('provider', 'name providerProfile.displayName').sort({ requestedStart: -1 }).skip(skip).limit(limit).lean(), Booking.countDocuments(filter)]);
  sendPage(res, items, total, page, limit);
}));

bookingsRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const booking = await Booking.findById(parseObjectId(req.params.id, 'booking id'));
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const userId = String(getAuthUser(req)._id);
  // Authorize against raw ObjectId references before populating participant details.
  if (String(booking.farmer) !== userId && String(booking.provider) !== userId) throw new HttpError(403, 'You cannot view this booking.');
  await booking.populate([{ path: 'listing' }, { path: 'farmer', select: 'name' }, { path: 'provider', select: 'name' }]);
  res.json({ data: booking });
}));

bookingsRouter.post('/:id/counter-offer', requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ rate: rateSchema, note: z.string().trim().max(500).optional().default('') }).parse(req.body);
  const booking = await Booking.findById(parseObjectId(req.params.id, 'booking id'));
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const user = getAuthUser(req), id = String(user._id), isFarmer = String(booking.farmer) === id && user.roles.includes('farmer'), isProvider = String(booking.provider) === id && user.roles.includes('machinery_provider');
  if (!isFarmer && !isProvider) throw new HttpError(403, 'You are not a participant in this booking.');
  if (!['requested', 'negotiation'].includes(booking.status)) throw new HttpError(409, 'This booking is no longer open for negotiation.');
  if (booking.proposalHistory.length && String(booking.proposalHistory[booking.proposalHistory.length - 1]?.proposer) === id) throw new HttpError(409, 'Wait for the other participant to respond.');
  booking.proposalHistory.push({ proposer: user._id as any, wage: body.rate as any, note: body.note } as any);
  booking.status = 'negotiation'; await booking.save();
  await notify(isFarmer ? booking.provider : booking.farmer, 'booking_counter_offer', 'Machinery booking counter-offer', 'New booking terms were proposed.', 'booking', booking._id);
  res.json({ data: booking });
}));

bookingsRouter.post('/:id/respond', requireAuth, asyncHandler(async (req, res) => {
  const { action, note } = z.object({ action: z.enum(['accept', 'accept_counter', 'decline', 'cancel', 'complete']), note: z.string().trim().max(500).optional().default('') }).parse(req.body);
  const booking = await Booking.findById(parseObjectId(req.params.id, 'booking id'));
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const user = getAuthUser(req), id = String(user._id), isFarmer = String(booking.farmer) === id && user.roles.includes('farmer'), isProvider = String(booking.provider) === id && user.roles.includes('machinery_provider');
  if (!isFarmer && !isProvider) throw new HttpError(403, 'You are not a participant in this booking.');
  if (action === 'decline' || action === 'cancel') {
    if (action === 'decline' && (!isProvider || !['requested', 'negotiation'].includes(booking.status))) throw new HttpError(409, 'Only the provider can decline a pending booking.');
    if (action === 'cancel' && (!['requested', 'negotiation', 'confirmed'].includes(booking.status) || !note)) throw new HttpError(409, 'Provide a reason to cancel an eligible booking.');
    const next = action === 'decline' ? 'declined' : 'cancelled';
    assertCanTransition(booking.status, next, bookingTransitions);
    booking.status = next as any; if (action === 'cancel') booking.cancellationReason = note;
    await booking.save();
    await notify(isFarmer ? booking.provider : booking.farmer, `booking_${next}`, 'Machinery booking updated', `The booking has been ${next}.`, 'booking', booking._id);
    return res.json({ data: booking });
  }
  if (action === 'complete') {
    if (!isProvider || booking.status !== 'confirmed') throw new HttpError(409, 'Only the provider can complete a confirmed booking.');
    booking.status = 'completed'; await booking.save();
    await notify(booking.farmer, 'booking_completed', 'Machinery booking completed', 'The provider marked the booking as completed.', 'booking', booking._id);
    return res.json({ data: booking });
  }
  let rate: any;
  if (action === 'accept') {
    if (!isProvider || booking.status !== 'requested') throw new HttpError(409, 'Only the provider can accept the original booking request.');
    rate = booking.proposedRate;
  } else {
    if (booking.status !== 'negotiation' || !booking.proposalHistory.length) throw new HttpError(409, 'There is no counter-offer to accept.');
    const latest = booking.proposalHistory[booking.proposalHistory.length - 1]!;
    if (String(latest.proposer) === id) throw new HttpError(409, 'The other participant must respond to the latest counter-offer.');
    rate = latest.wage;
  }
  // Use a transaction so simultaneous confirmations cannot double-book the same equipment.
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const listing = await MachineryListing.findById(booking.listing).session(session);
      if (!listing || listing.status !== 'active' || !listing.available) throw new HttpError(409, 'This equipment is no longer available.');
      await MachineryListing.updateOne({ _id: listing._id }, { $inc: { __v: 1 } }, { session });
      const start = booking.requestedStart, end = new Date(start.getTime() + booking.durationHours * 60 * 60 * 1000);
      const conflict = await Booking.findOne({ _id: { $ne: booking._id }, listing: listing._id, status: 'confirmed', $expr: { $and: [{ $lt: ['$requestedStart', end] }, { $gt: [{ $add: ['$requestedStart', { $multiply: ['$durationHours', 3600000] }] }, start] }] } }).session(session);
      if (conflict) throw new HttpError(409, 'This equipment already has a confirmed booking during the requested time.');
      const updated = await Booking.findOneAndUpdate({ _id: booking._id, status: booking.status }, { $set: { status: 'confirmed', agreedRate: rate } }, { new: true, session });
      if (!updated) throw new HttpError(409, 'This booking was updated by another participant. Refresh and try again.');
    });
  } finally { await session.endSession(); }
  const updatedBooking = await Booking.findById(booking._id);
  await notify(booking.farmer, 'booking_confirmed', 'Machinery booking confirmed', 'The booking is confirmed with agreed rental terms.', 'booking', booking._id);
  await notify(booking.provider, 'booking_confirmed', 'Machinery booking confirmed', 'A booking has been confirmed.', 'booking', booking._id);
  res.json({ data: updatedBooking });
}));

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
