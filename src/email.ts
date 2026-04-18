import nodemailer from "nodemailer";

export async function sendDigestEmail(options: {
  subject: string;
  body: string;
  to: string;
  from: string;
  /**
   * Optional display name prepended to the `from` address for the SMTP
   * envelope (e.g. `"Cortex <noreply@example.com>"`). Already-formatted
   * `from` values (those containing `<`) are passed through unchanged.
   */
  fromName?: string;
  smtp: { host: string; port: number; user: string; pass: string };
}): Promise<void> {
  const transport = nodemailer.createTransport({
    host: options.smtp.host,
    port: options.smtp.port,
    auth: {
      user: options.smtp.user,
      pass: options.smtp.pass,
    },
  });

  const envelopeFrom =
    options.fromName && options.from && !options.from.includes("<")
      ? `${options.fromName} <${options.from}>`
      : options.from;

  await transport.sendMail({
    from: envelopeFrom,
    to: options.to,
    subject: options.subject,
    text: options.body,
  });
}

export function isSmtpConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}
