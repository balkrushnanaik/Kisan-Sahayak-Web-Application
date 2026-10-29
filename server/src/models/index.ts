import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const geoPointSchema = new Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], validate: (v: number[]) => v.length === 2 && v.every(Number.isFinite) },
}, { _id: false });

const locationSchema = new Schema({
  village: { type: String, trim: true, maxlength: 100 },
  taluka: { type: String, trim: true, maxlength: 100 },
  district: { type: String, trim: true, maxlength: 100 },
  state: { type: String, trim: true, maxlength: 100, default: 'Maharashtra' },
  point: { type: geoPointSchema, default: undefined },
}, { _id: false });

const wageSchema = new Schema({
  amount: { type: Number, required: true, min: 0, max: 10000000 },
  basis: { type: String, enum: ['hour', 'worker_day', 'task', 'hour_rental', 'day_rental', 'acre', 'booking'], required: true },
  currency: { type: String, enum: ['INR'], default: 'INR' },
}, { _id: false });

const farmerProfileSchema = new Schema({ farmName: { type: String, trim: true, maxlength: 120 }, location: locationSchema }, { _id: false });
const labourerProfileSchema = new Schema({
  skills: { type: [String], default: [] }, experienceYears: { type: Number, min: 0, max: 80, default: 0 },
  serviceArea: locationSchema, preferredWorkTypes: { type: [String], default: [] },
  expectedWage: { type: wageSchema, default: undefined }, available: { type: Boolean, default: false },
  availabilityDates: { type: [Date], default: [] }, bio: { type: String, trim: true, maxlength: 800 },
}, { _id: false });
const providerProfileSchema = new Schema({
  displayName: { type: String, trim: true, maxlength: 120 }, serviceArea: locationSchema,
  description: { type: String, trim: true, maxlength: 1000 }, contactPreference: { type: String, enum: ['in_app', 'phone'], default: 'in_app' },
}, { _id: false });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, lowercase: true, trim: true, sparse: true, unique: true, maxlength: 254 },
  mobile: { type: String, trim: true, sparse: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  roles: { type: [String], enum: ['farmer', 'labourer', 'machinery_provider', 'admin'], default: ['farmer'], validate: (v: string[]) => v.length > 0 },
  activeRole: { type: String, enum: ['farmer', 'labourer', 'machinery_provider'], default: 'farmer' },
  preferredLanguage: { type: String, enum: ['en', 'mr', 'hi'], default: 'en' },
  status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active' },
  demo: { type: Boolean, default: false },
  avatarUrl: { type: String, default: '' },
  farmerProfile: { type: farmerProfileSchema, default: undefined },
  labourerProfile: { type: labourerProfileSchema, default: undefined },
  providerProfile: { type: providerProfileSchema, default: undefined },
  termsAcceptedAt: { type: Date, required: true },
}, { timestamps: true, toJSON: { transform: (_doc, ret) => { delete ret.passwordHash; delete ret.__v; return ret; } } });
userSchema.index({ 'labourerProfile.serviceArea.point': '2dsphere' });
userSchema.index({ 'labourerProfile.skills': 1, 'labourerProfile.available': 1 });

const jobSchema = new Schema({
  farmer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  crop: { type: String, trim: true, maxlength: 100, default: '' },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
  requiredSkills: { type: [String], default: [] }, location: { type: locationSchema, required: true },
  workDate: { type: Date, required: true, index: true }, startTime: { type: String, default: '' }, durationHours: { type: Number, required: true, min: 1, max: 24 },
  workersNeeded: { type: Number, required: true, min: 1, max: 500 }, workersConfirmed: { type: Number, default: 0, min: 0 }, wage: { type: wageSchema, required: true },
  status: { type: String, enum: ['draft', 'open', 'partially_filled', 'filled', 'in_progress', 'completed', 'cancelled', 'closed'], default: 'open', index: true },
  demo: { type: Boolean, default: false },
}, { timestamps: true });
jobSchema.index({ 'location.point': '2dsphere' });
jobSchema.index({ status: 1, category: 1, workDate: 1, 'location.district': 1 });

const applicationSchema = new Schema({
  job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
  farmer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  labourer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, trim: true, maxlength: 800, default: '' },
  relevantExperience: { type: String, trim: true, maxlength: 800, default: '' },
  status: { type: String, enum: ['pending', 'offer_received', 'negotiation', 'confirmed', 'declined', 'withdrawn', 'closed'], default: 'pending', index: true },
}, { timestamps: true });
applicationSchema.index({ job: 1, labourer: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'offer_received', 'negotiation', 'confirmed'] } } });

const proposalSchema = new Schema({ proposer: { type: Schema.Types.ObjectId, ref: 'User', required: true }, wage: { type: wageSchema, required: true }, note: { type: String, trim: true, maxlength: 500, default: '' }, createdAt: { type: Date, default: Date.now } }, { _id: false });
const workRequestSchema = new Schema({
  farmer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, labourer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  job: { type: Schema.Types.ObjectId, ref: 'Job', default: undefined }, sourceType: { type: String, enum: ['application', 'direct_invitation'], default: 'direct_invitation' },
  title: { type: String, required: true, trim: true, maxlength: 120 }, category: { type: String, required: true, trim: true, maxlength: 80 },
  workDate: { type: Date, required: true }, durationHours: { type: Number, required: true, min: 1, max: 24 }, location: { type: locationSchema, required: true },
  workersCount: { type: Number, min: 1, default: 1 }, proposedWage: { type: wageSchema, required: true }, agreedWage: { type: wageSchema, default: undefined },
  status: { type: String, enum: ['pending', 'negotiation', 'accepted', 'declined', 'expired', 'cancelled'], default: 'pending', index: true },
  proposalHistory: { type: [proposalSchema], default: [] }, expiresAt: { type: Date, default: undefined },
}, { timestamps: true });

workRequestSchema.index({ job: 1, labourer: 1 }, { unique: true, partialFilterExpression: { job: { $exists: true }, status: { $in: ['pending', 'negotiation', 'accepted'] } } });

const assignmentSchema = new Schema({
  farmer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, labourer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  job: { type: Schema.Types.ObjectId, ref: 'Job', default: undefined }, workRequest: { type: Schema.Types.ObjectId, ref: 'WorkRequest', default: undefined },
  title: { type: String, required: true }, workDate: { type: Date, required: true }, location: { type: locationSchema, required: true },
  agreedWage: { type: wageSchema, required: true }, status: { type: String, enum: ['confirmed', 'in_progress', 'completed', 'cancelled', 'disputed'], default: 'confirmed', index: true },
  completionNote: { type: String, trim: true, maxlength: 1000, default: '' }, cancellationReason: { type: String, trim: true, maxlength: 500, default: '' }, paymentStatus: { type: String, enum: ['not_recorded', 'unpaid', 'partially_paid', 'paid'], default: 'not_recorded' },
}, { timestamps: true });

const listingSchema = new Schema({
  provider: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, category: { type: String, required: true, enum: ['tractor', 'rotavator', 'harvester', 'seed_drill', 'sprayer', 'other'] },
  name: { type: String, required: true, trim: true, maxlength: 120 }, model: { type: String, trim: true, maxlength: 120, default: '' }, description: { type: String, trim: true, maxlength: 2000, default: '' }, photos: { type: [String], default: [] },
  specifications: { type: Map, of: String, default: {} }, location: { type: locationSchema, required: true }, rentalRate: { type: wageSchema, required: true }, minDuration: { type: Number, min: 1, default: 1 }, operatorIncluded: { type: Boolean, default: false }, fuelIncluded: { type: Boolean, default: false }, transportDetails: { type: String, trim: true, maxlength: 500, default: '' }, available: { type: Boolean, default: true }, status: { type: String, enum: ['active', 'paused', 'removed'], default: 'active', index: true }, demo: { type: Boolean, default: false },
}, { timestamps: true });
listingSchema.index({ 'location.point': '2dsphere' });
listingSchema.index({ category: 1, status: 1, available: 1, 'location.district': 1 });

const bookingSchema = new Schema({
  farmer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, provider: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, listing: { type: Schema.Types.ObjectId, ref: 'MachineryListing', required: true, index: true },
  requestedStart: { type: Date, required: true }, durationHours: { type: Number, required: true, min: 1, max: 24 * 30 }, location: { type: locationSchema, required: true }, intendedUse: { type: String, trim: true, maxlength: 1000, default: '' },
  proposedRate: { type: wageSchema, required: true }, agreedRate: { type: wageSchema, default: undefined }, status: { type: String, enum: ['requested', 'negotiation', 'confirmed', 'declined', 'cancelled', 'completed'], default: 'requested', index: true },
  proposalHistory: { type: [proposalSchema], default: [] }, cancellationReason: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true });

const notificationSchema = new Schema({ recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, type: { type: String, required: true, maxlength: 80 }, title: { type: String, required: true, maxlength: 180 }, message: { type: String, required: true, maxlength: 500 }, relatedType: { type: String, enum: ['job', 'application', 'work_request', 'assignment', 'listing', 'booking', 'report'], default: undefined }, relatedId: { type: Schema.Types.ObjectId, default: undefined }, readAt: { type: Date, default: undefined } }, { timestamps: true });
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

const reviewSchema = new Schema({ reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true }, reviewee: { type: Schema.Types.ObjectId, ref: 'User', required: true }, assignment: { type: Schema.Types.ObjectId, ref: 'Assignment', default: undefined }, booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: undefined }, rating: { type: Number, required: true, min: 1, max: 5 }, text: { type: String, trim: true, maxlength: 1000, default: '' }, moderationStatus: { type: String, enum: ['pending', 'approved', 'hidden'], default: 'pending' } }, { timestamps: true });
reviewSchema.index({ reviewer: 1, assignment: 1 }, { unique: true, partialFilterExpression: { assignment: { $exists: true } } });
reviewSchema.index({ reviewer: 1, booking: 1 }, { unique: true, partialFilterExpression: { booking: { $exists: true } } });
reviewSchema.index({ reviewer: 1, assignment: 1 }, { unique: true, partialFilterExpression: { assignment: { $exists: true } } });
reviewSchema.index({ reviewer: 1, booking: 1 }, { unique: true, partialFilterExpression: { booking: { $exists: true } } });

const reportSchema = new Schema({ reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true }, reportedUser: { type: Schema.Types.ObjectId, ref: 'User', default: undefined }, listing: { type: Schema.Types.ObjectId, default: undefined }, reason: { type: String, required: true, enum: ['unsafe_behaviour', 'misleading_listing', 'abuse', 'spam', 'other'] }, details: { type: String, trim: true, maxlength: 2000, default: '' }, status: { type: String, enum: ['open', 'investigating', 'resolved', 'dismissed'], default: 'open', index: true }, resolution: { type: String, trim: true, maxlength: 1000, default: '' }, resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: undefined } }, { timestamps: true });
const auditSchema = new Schema({ admin: { type: Schema.Types.ObjectId, ref: 'User', required: true }, action: { type: String, required: true }, entityType: { type: String, required: true }, entityId: { type: Schema.Types.ObjectId, required: true }, reason: { type: String, trim: true, maxlength: 1000, default: '' } }, { timestamps: true });

function model<T>(name: string, schema: Schema) {
  return (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export const User = model('User', userSchema);
export const Job = model('Job', jobSchema);
export const JobApplication = model('JobApplication', applicationSchema);
export const WorkRequest = model('WorkRequest', workRequestSchema);
export const Assignment = model('Assignment', assignmentSchema);
export const MachineryListing = model('MachineryListing', listingSchema);
export const Booking = model('Booking', bookingSchema);
export const Notification = model('Notification', notificationSchema);
export const Review = model('Review', reviewSchema);
export const Report = model('Report', reportSchema);
export const AdminAuditLog = model('AdminAuditLog', auditSchema);

export type UserDocument = InferSchemaType<typeof userSchema>;
export type JobDocument = InferSchemaType<typeof jobSchema>;
export type WageBasis = 'hour' | 'worker_day' | 'task' | 'hour_rental' | 'day_rental' | 'acre' | 'booking';
export type Role = 'farmer' | 'labourer' | 'machinery_provider' | 'admin';
