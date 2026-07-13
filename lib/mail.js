import nodemailer from 'nodemailer';
import { getDb } from './db.js';

// Load SMTP config from MongoDB settings collection at runtime
async function getSmtpConfig() {
  try {
    const db = await getDb();
    const doc = await db.collection('settings').findOne({ key: 'smtp' });
    return doc?.value || null;
  } catch {
    return null;
  }
}

// Send an email using the SMTP config stored in MongoDB.
// If no config is found, logs a warning and returns without throwing.
export async function sendMail({ to, subject, text, html, smtpConfig = null }) {
  const cfg = smtpConfig || await getSmtpConfig();
  if (!cfg || !cfg.host || !cfg.user || !cfg.pass) {
    console.warn('[ITdock mail] SMTP not configured — email skipped');
    return { skipped: true };
  }

  const headerValues = [to, subject, cfg.host, cfg.user, cfg.fromName, cfg.fromAddress].filter(Boolean);
  if (headerValues.some(value => /[\r\n]/.test(String(value)))) {
    throw new Error('Email configuration contains invalid header characters');
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: parseInt(cfg.port, 10) || 587,
    secure: cfg.secure === 'ssl',
    requireTLS: cfg.secure !== 'none' && cfg.secure !== 'ssl',
    auth: { user: cfg.user, pass: cfg.pass },
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  const from = cfg.fromName
    ? `"${cfg.fromName}" <${cfg.fromAddress || cfg.user}>`
    : cfg.fromAddress || cfg.user;

  await transporter.sendMail({ from, to, subject, text, html, disableFileAccess: true, disableUrlAccess: true });
  return { sent: true };
}
