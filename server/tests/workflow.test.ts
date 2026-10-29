import { describe, expect, it } from 'vitest';
import { assertCanTransition, bookingTransitions, jobTransitions, requestTransitions } from '../src/services/workflow.js';
import { HttpError, pagination, parseObjectId } from '../src/utils/http.js';

describe('workflow transitions', () => {
  it('allows valid job lifecycle transitions', () => {
    expect(() => assertCanTransition('draft', 'open', jobTransitions)).not.toThrow();
    expect(() => assertCanTransition('open', 'partially_filled', jobTransitions)).not.toThrow();
  });
  it('rejects impossible transitions with a conflict error', () => {
    try { assertCanTransition('completed', 'open', jobTransitions); throw new Error('Expected transition to fail.'); }
    catch (error) { expect(error).toBeInstanceOf(HttpError); expect((error as HttpError).statusCode).toBe(409); }
  });
  it('does not permit accepting an already completed assignment-style offer twice', () => {
    expect(requestTransitions.accepted).toEqual([]);
    expect(bookingTransitions.completed).toEqual([]);
  });
});

describe('HTTP utilities', () => {
  it('clamps page and limit inputs to safe ranges', () => {
    expect(pagination({ page: '0', limit: '500' })).toMatchObject({ page: 1, limit: 50, skip: 0 });
    expect(pagination({ page: '3', limit: '10' })).toMatchObject({ page: 3, limit: 10, skip: 20 });
  });
  it('rejects malformed object ids before querying MongoDB', () => {
    expect(() => parseObjectId('abc', 'job id')).toThrow(HttpError);
  });
});
