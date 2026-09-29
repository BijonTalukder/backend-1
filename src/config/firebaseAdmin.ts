import {
  initializeApp,
  getApp,
  getApps,
  cert,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import config from './config';

let app: App | null = null;

/** Shape of the downloaded Google service account JSON (snake_case). */
type RawServiceAccountJson = {
  project_id?: string;
  private_key?: string;
  client_email?: string;
};

/** Project-root location of the stored service account JSON. */
const DEFAULT_SERVICE_ACCOUNT_PATH = path.resolve(
  __dirname,
  '../../firebase-service-account.json',
);

const notConfigured = (detail: string): Error & { code: string } => {
  const error = new Error(
    `Firebase Admin is not configured: ${detail}`,
  ) as Error & { code: string };
  error.code = 'FIREBASE_NOT_CONFIGURED';
  return error;
};

/** Maps the downloaded JSON (snake_case) to the SDK credential shape. */
const toServiceAccount = (
  raw: RawServiceAccountJson,
  source: string,
): ServiceAccount => {
  if (!raw.project_id || !raw.private_key || !raw.client_email) {
    throw notConfigured(`${source} is missing required fields`);
  }
  return {
    projectId: raw.project_id,
    clientEmail: raw.client_email,
    privateKey: raw.private_key,
  };
};

/**
 * Resolves the Admin SDK credentials. Sources, in order of precedence:
 *
 *   1. FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 *   2. FIREBASE_SERVICE_ACCOUNT_JSON  (raw JSON string in the environment)
 *   3. FIREBASE_SERVICE_ACCOUNT_PATH  (default: firebase-service-account.json
 *      in the backend project root — stored server-side only)
 */
const loadServiceAccount = (): ServiceAccount => {
  const { projectId, clientEmail, privateKey } = config.firebase;

  // 1) Explicit environment variables
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  // 2) Raw JSON in an environment variable (serverless-friendly)
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    let parsed: RawServiceAccountJson;
    try {
      parsed = JSON.parse(raw) as RawServiceAccountJson;
    } catch {
      throw notConfigured('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    return toServiceAccount(parsed, 'FIREBASE_SERVICE_ACCOUNT_JSON');
  }

  // 3) Service account file
  const serviceAccountPath = path.resolve(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
      DEFAULT_SERVICE_ACCOUNT_PATH,
  );

  if (!existsSync(serviceAccountPath)) {
    throw notConfigured(`service account file not found at ${serviceAccountPath}`);
  }

  let parsed: RawServiceAccountJson;
  try {
    parsed = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as RawServiceAccountJson;
  } catch {
    throw notConfigured('service account file could not be parsed');
  }
  return toServiceAccount(parsed, serviceAccountPath);
};

const getFirebaseAdminApp = (): App => {
  if (app) return app;

  const serviceAccount = loadServiceAccount();

  app = getApps().length
    ? getApp()
    : initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.projectId,
      });

  return app;
};

/**
 * Verifies a Firebase ID token sent by the client and returns the
 * verified payload. Only this payload may be trusted for identity.
 */
export const verifyFirebaseIdToken = async (
  idToken: string,
): Promise<DecodedIdToken> => {
  return getAuth(getFirebaseAdminApp()).verifyIdToken(idToken);
};

export default getFirebaseAdminApp;
