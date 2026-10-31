// utils/sendEmail.ts
import nodemailer, { type Transporter } from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * A single pooled transporter for the whole process.
 *
 * Creating a transport per email meant every send paid a fresh TCP+TLS
 * handshake to the SMTP server — roughly 2–4 seconds each. Sending a
 * campaign to ~110 recipients then took well over the serverless function
 * budget, so campaigns were killed mid-flight and their counters were
 * never written. A pooled transport keeps the connection warm and lets
 * concurrent sends share it.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Keep the connection alive between sends so we don't re-handshake.
    pool: true,
    maxConnections: 20,
    maxMessages: 100,
    // Fail fast instead of hanging until the function budget is gone.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: {
      rejectUnauthorized: false,
    },
  });

  return transporter;
}

const sendEmail = async (options: EmailOptions): Promise<void> => {
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || `No Reply <${process.env.SMTP_USER}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
};

/** Close pooled connections on shutdown so the process can exit cleanly. */
export async function closeEmailTransport(): Promise<void> {
  if (!transporter) return;
  transporter.close();
  transporter = null;
}

export default sendEmail;
