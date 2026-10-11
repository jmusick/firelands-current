import { env } from 'cloudflare:workers';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface AccountMail {
  to: { email: string; name: string };
  subject: string;
  heading: string;
  intro: string;
  action: string;
  url: string;
  outro: string;
}

// Sender must be on the onboarded domain (see "Email sending" in the README).
async function sendAccountMail(mail: AccountMail): Promise<void> {
  // Local dev has no real sender, so print the link where the developer can click it.
  if (import.meta.env.DEV) console.log(`[mail] ${mail.subject} for ${mail.to.email}: ${mail.url}`);
  const text = `${mail.heading}\n\n${mail.intro}\n\n${mail.action}: ${mail.url}\n\n${mail.outro}\n\nFirelands Current`;
  const html = `<div style="font-family:Georgia,serif;max-width:32rem;margin:0 auto;color:#172f36">
<h1 style="font-size:1.4rem">${escapeHtml(mail.heading)}</h1>
<p>${escapeHtml(mail.intro)}</p>
<p><a href="${escapeHtml(mail.url)}" style="display:inline-block;background:#173d4a;color:#fff;padding:.7rem 1.2rem;border-radius:4px;text-decoration:none;font-weight:bold">${escapeHtml(mail.action)}</a></p>
<p style="font-size:.9rem;color:#555">Or paste this link into your browser:<br>${escapeHtml(mail.url)}</p>
<p style="font-size:.9rem;color:#555">${escapeHtml(mail.outro)}</p>
<p style="font-size:.9rem;color:#555">Firelands Current</p></div>`;
  try {
    await env.EMAIL.send({
      to: mail.to.email,
      from: { email: 'noreply@firelandscurrent.com', name: 'Firelands Current' },
      subject: mail.subject,
      text,
      html,
    });
  } catch (err) {
    // A failed send must not reveal whether the address has an account; the person can request another.
    console.error('account email failed', err);
  }
}

export function sendVerificationMail(user: { email: string; name: string }, url: string) {
  return sendAccountMail({
    to: user,
    subject: 'Confirm your email address',
    heading: 'Confirm your email address',
    intro: `Hi ${user.name}, confirm this email address for your Firelands Current account. The link works for one hour.`,
    action: 'Confirm email address',
    url,
    outro: "If you didn't request an account or email change, you can ignore this message.",
  });
}

export function sendPasswordResetMail(user: { email: string; name: string }, url: string) {
  return sendAccountMail({
    to: user,
    subject: 'Reset your password',
    heading: 'Reset your password',
    intro: `Hi ${user.name}, use the link below to choose a new Firelands Current password. It works for one hour.`,
    action: 'Choose a new password',
    url,
    outro: "If you didn't ask for this, you can ignore this message; your password has not changed.",
  });
}

/**
 * A plain message to the site owner, for the security alerts in auth-alerts.ts. The text is built from counts
 * and truncated hashes only; it is escaped here anyway so nothing in it can become markup.
 */
export async function sendSecurityAlertMail(mail: { to: string; subject: string; text: string }): Promise<void> {
  if (import.meta.env.DEV) console.log(`[mail] ${mail.subject} for ${mail.to}
${mail.text}`);
  await env.EMAIL.send({
    to: mail.to,
    from: { email: 'noreply@firelandscurrent.com', name: 'Firelands Current' },
    subject: mail.subject,
    text: mail.text,
    html: `<div style="font-family:Georgia,serif;max-width:36rem;color:#172f36"><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(mail.text)}</pre></div>`,
  });
}
