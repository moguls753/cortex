import nodemailer from "nodemailer";

export async function sendDigestEmail(options: {
  subject: string;
  body: string;
  to: string;
  from: string;
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

  await transport.sendMail({
    from: options.from,
    to: options.to,
    subject: options.subject,
    text: options.body,
  });
}

export function isSmtpConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}
