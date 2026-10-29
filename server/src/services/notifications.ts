import { Notification } from '../models/index.js';

/**
 * Persist an in-app notification for a completed business event.
 * Notification persistence is best-effort so a notification write error cannot
 * turn an already-committed job/offer/booking operation into a misleading 500.
 * Failures remain visible in server logs for diagnosis.
 */
export async function notify(recipient: unknown, type: string, title: string, message: string, relatedType?: string, relatedId?: unknown) {
  if (!recipient) return;
  try {
    await Notification.create({ recipient, type, title, message, relatedType, relatedId });
  } catch (error) {
    console.error('[notification] Could not persist in-app notification', {
      type,
      relatedType,
      relatedId: relatedId ? String(relatedId) : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
