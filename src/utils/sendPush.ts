// utils/sendPush.ts
//
// Wraps firebase-admin's `messaging().sendEachForMulticast` so the controller
// layer can stay free of SDK details. Tokens reported as invalid by FCM are
// returned separately so the caller can remove them from `User.fcmTokens`.

import { getMessaging } from 'firebase-admin/messaging';
import getFirebaseAdminApp from '../config/firebaseAdmin';

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  errors: { token: string; code?: string; message: string }[];
}

const NOT_REGISTERED_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Send the same notification to up to 500 device tokens at a time. Returns
 * per-token results so callers can update User.fcmTokens and emit metrics.
 *
 * Throws only on configuration errors (no app initialised). Per-token
 * failures are surfaced in `result.errors` and never throw.
 */
export async function sendFcmToTokens(
  tokens: string[],
  payload: FcmPayload,
): Promise<FcmSendResult> {
  const result: FcmSendResult = {
    successCount: 0,
    failureCount: 0,
    invalidTokens: [],
    errors: [],
  };

  if (tokens.length === 0) return result;

  const messaging = getMessaging(getFirebaseAdminApp());

  // firebase-admin limits each batch to 500 tokens.
  const BATCH = 500;
  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);

    let response;
    try {
      response = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
        },
        data: payload.data,
        android: { priority: 'high' },
      });
    } catch (err) {
      // Whole-batch error — record against every token in the chunk.
      const message = err instanceof Error ? err.message : 'unknown';
      for (const t of batch) {
        result.failureCount += 1;
        result.errors.push({ token: t, message });
      }
      continue;
    }

    response.responses.forEach((r: { success: boolean; error?: { code?: string; message?: string } }, idx: number) => {
      const token = batch[idx];
      if (r.success) {
        result.successCount += 1;
        return;
      }
      const code = r.error?.code;
      const message = r.error?.message ?? 'unknown';
      result.failureCount += 1;
      result.errors.push({ token, code, message });
      if (code && NOT_REGISTERED_CODES.has(code)) {
        result.invalidTokens.push(token);
      }
    });
  }

  return result;
}