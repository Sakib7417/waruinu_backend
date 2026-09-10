const nodemailer = require('nodemailer');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SMTP_KEY = process.env.BREVO_SMTP_KEY;
const BREVO_SMTP_LOGIN = process.env.BREVO_SMTP_LOGIN;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@dagitariwaruinu.com';
const FROM_NAME = process.env.FROM_NAME || 'Dagitari Waruinu';

/**
 * Send an email using Brevo Transactional Email API or Brevo SMTP relay.
 * Falls back to logging the body in development if no key is set.
 */
async function sendEmail({ to, subject, text, html }) {
  if (!to) throw new Error('Recipient email is required');

  const smtpKey = BREVO_SMTP_KEY || (BREVO_API_KEY && BREVO_API_KEY.startsWith('xsmtpsib-') ? BREVO_API_KEY : undefined);
  const smtpLogin = BREVO_SMTP_LOGIN || FROM_EMAIL;

  if (smtpKey && smtpLogin) {
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: smtpLogin, pass: smtpKey },
    });
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      text,
      html: html || text,
    });
    return { success: true };
  }

  if (!BREVO_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BREVO_API_KEY is not configured');
    }
    // eslint-disable-next-line no-console
    console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${text}`);
    return { success: true, message: 'Email logged to console (BREVO_API_KEY not set)' };
  }

  const body = {
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: [{ email: to }],
    subject,
    htmlContent: html || text,
    textContent: text,
  };

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo email failed: ${res.status} ${errText}`);
  }

  return { success: true };
}

function sendVerificationOtp({ email, code, name }) {
  const subject = 'Your Dagitari Waruinu verification code';
  const text = `Hello ${name || ''},\n\nYour verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\nDagitari Waruinu`;
  const html = `<p>Hello ${name || ''},</p><p>Your verification code is: <strong style="font-size:18px;letter-spacing:2px">${code}</strong></p><p>This code will expire in 10 minutes.</p><p>If you did not request this, please ignore this email.</p><p>Dagitari Waruinu</p>`;
  return sendEmail({ to: email, subject, text, html });
}

function sendPasswordResetOtp({ email, code, name }) {
  const subject = 'Reset your Dagitari Waruinu password';
  const text = `Hello ${name || ''},\n\nYou requested a password reset. Your code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\nDagitari Waruinu`;
  const html = `<p>Hello ${name || ''},</p><p>You requested a password reset.</p><p>Your code is: <strong style="font-size:18px;letter-spacing:2px">${code}</strong></p><p>This code will expire in 10 minutes.</p><p>If you did not request this, please ignore this email.</p><p>Dagitari Waruinu</p>`;
  return sendEmail({ to: email, subject, text, html });
}

function sendLoginOtp({ email, code, name }) {
  const subject = 'Your Dagitari Waruinu login code';
  const text = `Hello ${name || ''},\n\nYour login verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\nDagitari Waruinu`;
  const html = `<p>Hello ${name || ''},</p><p>Your login verification code is: <strong style="font-size:18px;letter-spacing:2px">${code}</strong></p><p>This code will expire in 10 minutes.</p><p>If you did not request this, please ignore this email.</p><p>Dagitari Waruinu</p>`;
  return sendEmail({ to: email, subject, text, html });
}

module.exports = {
  sendEmail,
  sendVerificationOtp,
  sendPasswordResetOtp,
  sendLoginOtp,
};
