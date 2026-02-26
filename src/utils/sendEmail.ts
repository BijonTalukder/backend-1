// utils/sendEmail.ts
import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

const sendEmail = async (options: EmailOptions): Promise<void> => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"${process.env.APP_NAME}" <${process.env.SMTP_FROM}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
};

export default sendEmail;
