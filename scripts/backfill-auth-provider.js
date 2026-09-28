#!/usr/bin/env node
/**
 * Backfill / change `authProvider` on existing User documents.
 *
 * The `authProvider` field ('local' | 'google') was added together with
 * Google Sign-In. Accounts created before that field existed are all
 * email/password accounts and are backfilled to 'local'.
 *
 * Usage:
 *   node scripts/backfill-auth-provider.js                 # backfill all missing → 'local'
 *   node scripts/backfill-auth-provider.js --dry-run       # preview only, no writes
 *   node scripts/backfill-auth-provider.js --email=a@b.com --provider=google
 *   node scripts/backfill-auth-provider.js --email=a@b.com --provider=local
 *
 * npm: npm run backfill:auth-provider [-- --dry-run]
 */
require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const getArg = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : '';
};

const email = getArg('email');
const provider = getArg('provider');
const VALID_PROVIDERS = ['local', 'google'];

const report = async (users) => {
  const pipeline = [
    { $group: { _id: { $ifNull: ['$authProvider', '(missing)'] }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];
  const rows = await users.aggregate(pipeline).toArray();
  const line = rows.map((r) => `${r._id}: ${r.count}`).join('  |  ');
  console.log(`  authProvider breakdown → ${line || '(no users)'}`);
};

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const users = mongoose.connection.collection('users');

  console.log('\n=== User authProvider backfill ===');
  console.log(`mode: ${dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`);
  console.log('before:');
  await report(users);

  let matched = 0;
  let modified = 0;

  // ── Single account change ────────────────────────────────────────────
  if (email !== undefined) {
    if (!email || !provider || !VALID_PROVIDERS.includes(provider)) {
      console.error('For a single change use: --email=<email> --provider=local|google');
      process.exit(1);
    }

    const normalized = email.trim().toLowerCase();
    const existing = await users.findOne({ email: normalized });
    if (!existing) {
      console.error(`No user found with email: ${normalized}`);
      process.exit(1);
    }

    console.log(
      `account: ${normalized} | firebaseUid: ${existing.firebaseUid || '(none)'} | ` +
        `hasPassword: ${!!existing.password} | current authProvider: ${existing.authProvider || '(missing)'}`,
    );

    // Never mark a Google-linked account as 'local' or vice-versa silently:
    // the flags must stay consistent with how the user can actually sign in.
    if (provider === 'local' && existing.firebaseUid) {
      console.error(
        'Refused: this account has a firebaseUid (Google-linked). ' +
          'Changing it to "local" would leave a Google identity attached to a password account.',
      );
      process.exit(1);
    }
    if (provider === 'google' && existing.password) {
      console.error(
        'Refused: this account has a password (email/password sign-in). ' +
          'Changing it to "google" would hide the password login the user owns.',
      );
      process.exit(1);
    }

    if (!dryRun) {
      const res = await users.updateOne(
        { _id: existing._id },
        { $set: { authProvider: provider } },
      );
      modified = res.modifiedCount;
    }
    matched = 1;
  } else {
    // ── Bulk backfill of pre-Google accounts ────────────────────────────
    const filter = {
      $or: [{ authProvider: { $exists: false } }, { authProvider: null }],
      firebaseUid: { $exists: false },
    };
    matched = await users.countDocuments(filter);
    console.log(`accounts missing authProvider (and not Google-linked): ${matched}`);

    if (!dryRun && matched > 0) {
      const res = await users.updateMany(filter, { $set: { authProvider: 'local' } });
      modified = res.modifiedCount;
    }
  }

  if (dryRun) {
    console.log(`dry-run: would update ${matched} account(s)`);
  } else {
    console.log(`updated: ${modified} account(s)`);
  }

  console.log('after:');
  await report(users);

  // Consistency checks (always run, read-only)
  const googleWithoutUid = await users.countDocuments({
    authProvider: 'google',
    firebaseUid: { $exists: false },
  });
  const localWithUid = await users.countDocuments({
    authProvider: 'local',
    firebaseUid: { $exists: true },
  });
  console.log(
    `consistency: authProvider=google without firebaseUid: ${googleWithoutUid} | ` +
      `authProvider=local with firebaseUid: ${localWithUid}`,
  );
  console.log('');

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
