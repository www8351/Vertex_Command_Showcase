let _googlePromise: Promise<any> | null = null;
function getGoogle() {
  if (!_googlePromise) {
    _googlePromise = import('googleapis').then(mod => mod.google);
  }
  return _googlePromise;
}

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

async function getGmailClient() {
  const accessToken = await getAccessToken();
  const g = await getGoogle();
  const oauth2Client = new g.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return g.gmail({ version: 'v1', auth: oauth2Client });
}

export async function sendVerificationEmail(toEmail: string, toName: string, token: string) {
  const gmail = await getGmailClient();

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPLIT_DEPLOYMENT_URL
    ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
    : 'http://localhost:5000';

  const verifyUrl = `${baseUrl}/api/v1/auth/verify/${token}`;

  const subject = 'VERTEX COMMAND - אימות כתובת אימייל';
  const htmlBody = `
    <div dir="rtl" style="font-family: 'Heebo', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0f0f23; color: #e2e8f0; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: #4f46e5; line-height: 48px; text-align: center; color: white; font-weight: bold; font-size: 20px;">VC</div>
        <h1 style="margin: 12px 0 4px; font-size: 22px; color: #f8fafc;">VERTEX COMMAND</h1>
        <p style="margin: 0; font-size: 14px; color: #94a3b8;">Trading Command Center</p>
      </div>
      <div style="background: #1a1a2e; border: 1px solid #2d2d44; border-radius: 8px; padding: 24px; text-align: center;">
        <p style="font-size: 16px; margin: 0 0 8px; color: #e2e8f0;">שלום ${toName},</p>
        <p style="font-size: 14px; margin: 0 0 24px; color: #94a3b8;">לחץ על הכפתור למטה כדי לאמת את כתובת האימייל שלך ולהשלים את ההרשמה:</p>
        <a href="${verifyUrl}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">אמת את האימייל שלי</a>
        <p style="font-size: 12px; color: #64748b; margin: 20px 0 0;">אם הכפתור לא עובד, העתק את הקישור הבא לדפדפן:</p>
        <p dir="ltr" style="font-size: 11px; color: #64748b; word-break: break-all; margin: 4px 0 0;">${verifyUrl}</p>
      </div>
      <p style="text-align: center; font-size: 12px; color: #475569; margin-top: 16px;">אם לא נרשמת ל-VERTEX COMMAND, תתעלם מהודעה זו.</p>
    </div>
  `;

  const rawMessage = [
    `From: =?UTF-8?B?${Buffer.from('Vertex Command').toString('base64')}?= <me>`,
    `To: ${toName} <${toEmail}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64')
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage }
  });
}

export async function sendPasswordResetEmail(toEmail: string, toName: string, token: string) {
  const gmail = await getGmailClient();

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPLIT_DEPLOYMENT_URL
    ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
    : 'http://localhost:5000';

  const resetUrl = `${baseUrl}/?reset=${token}`;

  const subject = 'VERTEX COMMAND - איפוס סיסמה';
  const htmlBody = `
    <div dir="rtl" style="font-family: 'Heebo', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0f0f23; color: #e2e8f0; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: #4f46e5; line-height: 48px; text-align: center; color: white; font-weight: bold; font-size: 20px;">VC</div>
        <h1 style="margin: 12px 0 4px; font-size: 22px; color: #f8fafc;">VERTEX COMMAND</h1>
        <p style="margin: 0; font-size: 14px; color: #94a3b8;">Trading Command Center</p>
      </div>
      <div style="background: #1a1a2e; border: 1px solid #2d2d44; border-radius: 8px; padding: 24px; text-align: center;">
        <p style="font-size: 16px; margin: 0 0 8px; color: #e2e8f0;">שלום ${toName},</p>
        <p style="font-size: 14px; margin: 0 0 24px; color: #94a3b8;">קיבלנו בקשה לאיפוס הסיסמה שלך. לחץ על הכפתור למטה כדי ליצור סיסמה חדשה:</p>
        <a href="${resetUrl}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">איפוס סיסמה</a>
        <p style="font-size: 12px; color: #64748b; margin: 20px 0 0;">הקישור תקף ל-60 דקות בלבד.</p>
        <p dir="ltr" style="font-size: 11px; color: #64748b; word-break: break-all; margin: 4px 0 0;">${resetUrl}</p>
      </div>
      <p style="text-align: center; font-size: 12px; color: #475569; margin-top: 16px;">אם לא ביקשת לאפס את הסיסמה, תתעלם מהודעה זו.</p>
    </div>
  `;

  const rawResetMessage = [
    `From: =?UTF-8?B?${Buffer.from('Vertex Command').toString('base64')}?= <me>`,
    `To: ${toName} <${toEmail}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64')
  ].join('\r\n');

  const encodedResetMessage = Buffer.from(rawResetMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedResetMessage }
  });
}
