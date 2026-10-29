import { HttpError } from '../utils/http.js';

export function assertCanTransition(current: string, next: string, transitions: Record<string, string[]>) {
  if (!(transitions[current] ?? []).includes(next)) {
    throw new HttpError(409, `This record cannot move from "${current}" to "${next}". Refresh the page and try again.`, 'INVALID_STATE_TRANSITION');
  }
}

export const jobTransitions: Record<string, string[]> = {
  draft: ['open', 'cancelled'], open: ['partially_filled', 'filled', 'closed', 'cancelled'],
  partially_filled: ['open', 'filled', 'in_progress', 'closed', 'cancelled'], filled: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'], completed: [], cancelled: [], closed: [],
};
export const requestTransitions: Record<string, string[]> = { pending: ['negotiation', 'accepted', 'declined', 'cancelled'], negotiation: ['accepted', 'declined', 'cancelled'], accepted: [], declined: [], expired: [], cancelled: [] };
export const bookingTransitions: Record<string, string[]> = { requested: ['negotiation', 'confirmed', 'declined', 'cancelled'], negotiation: ['confirmed', 'declined', 'cancelled'], confirmed: ['completed', 'cancelled'], declined: [], cancelled: [], completed: [] };
