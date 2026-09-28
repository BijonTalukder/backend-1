require('dotenv').config();
const nodemailer = require('nodemailer');

const TO = 'bijontalukder1247@gmail.com';

(async () => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  console.log('1) Verifying SMTP connection...');
  try {
    const ok = await transporter.verify();
    console.log('   -> OK:', ok);
  } catch (err) {
    console.error('   -> FAILED:', err.message);
    process.exit(1);
  }

  console.log('2) Sending test email to', TO);
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || `No Reply <${process.env.SMTP_USER}>`,
      to: TO,
      subject: 'SMTP Test - backend-1',
      html: `<p>SMTP test from <b>backend-1</b>.</p>
             <p>Sent at ${new Date().toISOString()}</p>`,
    });
    console.log('   -> Sent. messageId:', info.response);
  } catch (err) {
    console.error('   -> FAILED:', err.message);
    process.exit(1);
  }
})();
