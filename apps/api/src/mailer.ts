export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

/**
 * SMTP over Cloudflare TCP sockets (implicit TLS on 465). `worker-mailer` imports `cloudflare:sockets`,
 * so it is loaded lazily and only inside the Worker runtime.
 */
export function smtpMailer(config: SmtpConfig): Mailer {
  return {
    async send(message) {
      const { WorkerMailer, LogLevel } = await import("worker-mailer");
      const mailer = await WorkerMailer.connect({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        startTls: config.port !== 465,
        credentials: { username: config.username, password: config.password },
        authType: ["plain", "login"],
        logLevel: LogLevel.NONE, // never log addresses or message content
        socketTimeoutMs: 10_000,
        responseTimeoutMs: 10_000,
      });
      try {
        await mailer.send({
          from: { name: config.fromName, email: config.fromEmail },
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
      } finally {
        await mailer.close().catch(() => {});
      }
    },
  };
}

/**
 * Local development only: prints the message (including the login link) to the console.
 * The API refuses to use it for requests that do not come from localhost (see app.ts).
 */
export function consoleMailer(): Mailer {
  return {
    async send(message) {
      console.log(`[dev-mail] to=${message.to}\n[dev-mail] subject=${message.subject}\n${message.text}`);
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function loginEmail(siteName: string, link: string, validMinutes: number): Omit<MailMessage, "to"> {
  const subject = `Prijava v urejevalnik – ${siteName}`;
  const text = [
    "Pozdravljeni,",
    "",
    `za prijavo v urejevalnik strani ${siteName} odprite to povezavo:`,
    link,
    "",
    `Povezava velja ${validMinutes} minut in jo lahko uporabite samo enkrat.`,
    "Če prijave niste zahtevali, to sporočilo prezrite.",
    "",
    "Inženirji.si",
  ].join("\n");
  const name = escapeHtml(siteName);
  const href = escapeHtml(link);
  const html = `<!doctype html><html lang="sl"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#15171a">
<p>Pozdravljeni,</p>
<p>za prijavo v urejevalnik strani <strong>${name}</strong> kliknite gumb:</p>
<p><a href="${href}" style="display:inline-block;padding:12px 20px;background:#1f7a4d;color:#fff;text-decoration:none;border-radius:8px">Prijava v urejevalnik</a></p>
<p style="color:#5d636b;font-size:14px">Povezava velja ${validMinutes} minut in jo lahko uporabite samo enkrat. Če prijave niste zahtevali, to sporočilo prezrite.</p>
<p style="color:#5d636b;font-size:14px">Inženirji.si</p>
</body></html>`;
  return { subject, text, html };
}
