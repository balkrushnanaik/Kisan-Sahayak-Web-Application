export const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(message: string, status: number, code = 'REQUEST_FAILED', details?: unknown) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details;
  }
}

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-Requested-With'] = 'XMLHttpRequest';
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      method, headers, credentials: 'include', signal: options.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError('We could not reach the server. Check that the API and MongoDB are running.', 0, 'NETWORK_ERROR');
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message ?? 'Something went wrong. Please try again.', response.status, error.code, error.details);
  }
  return payload as T;
}

export type User = {
  _id: string; id?: string; name: string; email?: string; mobile?: string; roles: ('farmer' | 'labourer' | 'machinery_provider' | 'admin')[]; activeRole?: 'farmer' | 'labourer' | 'machinery_provider';
  preferredLanguage: 'en' | 'mr' | 'hi'; status: 'active' | 'pending' | 'suspended'; avatarUrl?: string;
  farmerProfile?: { farmName?: string; location?: Location };
  labourerProfile?: { skills?: string[]; experienceYears?: number; serviceArea?: Location; expectedWage?: Wage; available?: boolean; availabilityDates?: string[]; bio?: string; preferredWorkTypes?: string[] };
  providerProfile?: { displayName?: string; serviceArea?: Location; description?: string };
};
export type Location = { village?: string; taluka?: string; district?: string; state?: string; point?: { type: 'Point'; coordinates: [number, number] } };
export type Wage = { amount: number; basis: string; currency?: 'INR' };
export type Page<T> = { data: T[]; pagination: { page: number; limit: number; total: number; pages: number }; unreadCount?: number };
export type Job = { _id: string; title: string; category: string; crop?: string; description: string; location: Location; workDate: string; startTime?: string; durationHours: number; workersNeeded: number; workersConfirmed: number; wage: Wage; status: string; farmer?: { name: string }; requiredSkills?: string[]; demo?: boolean };
export type Labourer = { id: string; name: string; skills: string[]; experienceYears: number; district: string; village: string; bio?: string; expectedWage?: Wage | null };
export type Machinery = { _id: string; provider?: { name: string; providerProfile?: { displayName?: string } }; name: string; model?: string; category: string; description: string; photos: string[]; location: Location; rentalRate: Wage; minDuration: number; operatorIncluded: boolean; fuelIncluded: boolean; transportDetails?: string; status: string; available: boolean; demo?: boolean };
export type Application = { _id: string; job: Job; farmer?: { name: string }; labourer?: any; status: string; message: string; createdAt: string };
export type WorkRequest = { _id: string; farmer: any; labourer: any; job?: Job; title: string; category: string; workDate: string; durationHours: number; location: Location; proposedWage: Wage; agreedWage?: Wage; proposalHistory: { proposer: string; wage: Wage; note?: string; createdAt: string }[]; status: string; sourceType: string };
export type Assignment = { _id: string; farmer: any; labourer: any; title: string; workDate: string; location: Location; agreedWage: Wage; status: string; completionNote?: string };
export type Booking = { _id: string; farmer: any; provider: any; listing: Machinery; requestedStart: string; durationHours: number; location: Location; proposedRate: Wage; agreedRate?: Wage; status: string; proposalHistory: { proposer: string; wage: Wage; note?: string }[] };
export type NotificationItem = { _id: string; type: string; title: string; message: string; relatedType?: string; relatedId?: string; readAt?: string; createdAt: string };

export async function uploadImage(file: File): Promise<{ url: string; name: string; size: number }> {
  const form = new FormData();
  form.append('image', file);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/uploads`, {
      method: 'POST', credentials: 'include',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: form,
    });
  } catch {
    throw new ApiError('The upload service could not be reached.', 0, 'NETWORK_ERROR');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload?.error?.message ?? 'Image upload failed.', response.status, payload?.error?.code);
  return payload.data as { url: string; name: string; size: number };
}
