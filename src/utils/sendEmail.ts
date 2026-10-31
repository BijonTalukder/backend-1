// utils/sendEmail.ts
import nodemailer, { type Transporter } from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

interface SmtpAccount {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
}

interface MailError extends Error {
  code?: string;
  responseCode?: number;
  command?: string;
}

/**
 * The primary and (optional) secondary SMTP accounts.
 *
 * A single Gmail account has a hard daily sending cap (550-5.4.5). Once it
 * is exhausted every further send fails, which silently kills bulk
 * campaigns. When a secondary account is configured we fail over to it so a
 * campaign can still reach the rest of its audience.
 *
 * Environment:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM  — primary account
 *   SMTP2_HOST, SMTP2_PORT, SMTP2_USER, SMTP2_PASS, SMTP2_FROM — optional
 *     secondary account used when the primary hits a sending limit.
 *     SMTP2_* are optional; without them the behaviour is unchanged.
 */
function readAccount(prefix: 'SMTP' | 'SMTP2'): SmtpAccount | null {
  const user = process.env[`${prefix}_USER`];
  const pass = process.env[`${prefix}_PASS`];
  if (!user || !pass) return null;
  return {
    host: process.env[`${prefix}_HOST`] ?? 'smtp.gmail.com',
    port: Number(process.env[`${prefix}_PORT`]) || 465,
    user,
    pass,
    from: process.env[`${prefix}_FROM`] ?? process.env.MAIL_FROM ?? `No Reply <${user}>`,
  };
}

/**
 * A single pooled transporter per account.
 *
 * Creating a transport per email meant every send paid a fresh TCP+TLS
 * handshake to the SMTP server — roughly 2–4 seconds each. Sending a
 * campaign to ~110 recipients then took well over the serverless function
 * budget, so campaigns were killed mid-flight and their counters were
 * never written. A pooled transport keeps the connection warm and lets
 * concurrent sends share it.
 */
const transporters = new Map<string, Transporter>();

function getTransporter(account: SmtpAccount): Transporter {
  const existing = transporters.get(account.user!);
  if (existing) return existing;

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    auth: { user: account.user, pass: account.pass },
    // Keep the connection alive between sends so we don't re-handshake.
    pool: true,
    maxConnections: 20,
    maxMessages: 100,
    // Fail fast instead of hanging until the function budget is gone.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { rejectUnauthorized: false },
  });

  transporters.set(account.user!, transporter);
  return transporter;
}

/**
 * True when the failure means "this account can't send right now" —
 * Gmail's daily cap or its short-term rate limiter. These are the cases
 * where switching to the secondary account is worthwhile.
 */
export function isMailboxLimitError(err: unknown): boolean {
  const e = err as MailError;
  const text = `${e?.message ?? ''} ${e?.responseCode ?? ''} ${e?.code ?? ''}`;
  return (
    /daily (user )?sending limit exceeded/i.test(text) ||
    /550[-\s]5\.4\.5/i.test(text) ||
    /421[-\s]4\.3\.0/i.test(text) ||
    /too many messages|quota exceeded/i.test(text)
  );
}

const sendEmail = async (options: EmailOptions): Promise<void> => {
  const primary = readAccount('SMTP');
  if (!primary) {
    throw new Error('SMTP is not configured (SMTP_USER / SMTP_PASS missing).');
  }

  const secondary = readAccount('SMTP2');

  try {
    await getTransporter(primary).sendMail({
      from: primary.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  } catch (err) {
    // Only fail over when the primary account is blocked. A bad recipient
    // address or malformed content fails the same way on both accounts.
    if (!secondary || !isMailboxLimitError(err)) throw err;

    console.warn(
      `[sendEmail] primary SMTP account (${primary.user}) hit a sending limit — failing over to the secondary account.`,
    );
    await getTransporter(secondary).sendMail({
      from: secondary.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  }
};

/** Close pooled connections on shutdown so the process can exit cleanly. */
export async function closeEmailTransport(): Promise<void> {
  for (const t of transporters.values()) t.close();
  transporters.clear();
}

export default sendEmail;
