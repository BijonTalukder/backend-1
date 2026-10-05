// utils/template/emailTemplates.ts
//
// All HisabBoi emails share the same dark, rounded shell so the brand
// stays consistent. Each public template below renders its body into
// `cashbookEmailBase`. When you add a new template, copy the existing shape
// and call the base — don't re-inline the shell or the emails will drift.

const BRAND = 'HisabBoi';
const BRAND_INITIAL = 'H';

interface BaseArgs {
  label: string;
  title: string;
  bodyHtml: string;
  footer?: string;
}

/**
 * Shared HisabBoi dark email shell. Body must be a string of inline-styled
 * HTML — no <style> blocks (Gmail strips them).
 */
export const cashbookEmailBase = ({
  label,
  title,
  bodyHtml,
  footer = "If you weren't expecting this, you can safely ignore this email.",
}: BaseArgs) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
          style="background:#0d1424;border-radius:20px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

          <tr>
            <td style="background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(16,185,129,0.03));
                       padding:32px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="background:#10b981;width:36px;height:36px;border-radius:10px;
                                display:inline-flex;align-items:center;justify-content:center;
                                vertical-align:middle;margin-right:10px;">
                      <span style="color:#022c22;font-size:18px;font-weight:900;line-height:1;">${BRAND_INITIAL}</span>
                    </div>
                    <span style="color:#fff;font-size:20px;font-weight:700;
                                 font-family:Georgia,serif;vertical-align:middle;">${BRAND}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 6px;color:#64748b;font-size:12px;text-transform:uppercase;
                         letter-spacing:1px;">${label}</p>
              <h1 style="margin:0 0 20px;color:#fff;font-size:26px;font-family:Georgia,serif;
                          font-weight:700;line-height:1.3;">${title}</h1>
              ${bodyHtml}
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.05);">
              <p style="margin:0;color:#1e293b;font-size:11px;">${footer}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ── Existing templates — preserved behaviour, now shell-thin ────────────────

export const inviteEmailTemplate = ({
  inviterName,
  businessName,
  role,
  inviteLink,
}: {
  inviterName: string;
  businessName: string;
  role: string;
  inviteLink: string;
}) =>
  cashbookEmailBase({
    label: 'You have an invitation',
    title: `Join <span style="color:#10b981;">${businessName}</span>`,
    bodyHtml: `
      <p style="margin:0 0 28px;color:#94a3b8;font-size:15px;line-height:1.7;">
        <strong style="color:#fff;">${inviterName}</strong> has invited you to collaborate
        on <strong style="color:#fff;">${businessName}</strong> as a
        <span style="background:rgba(16,185,129,0.12);color:#10b981;
                     padding:2px 10px;border-radius:20px;font-size:13px;font-weight:600;">
          ${role}
        </span>.
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <a href="${inviteLink}"
               style="background:#10b981;color:#022c22;text-decoration:none;
                      padding:14px 40px;border-radius:12px;font-weight:700;
                      font-size:15px;display:inline-block;letter-spacing:0.3px;">
              Accept Invitation →
            </a>
          </td>
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" width="100%"
        style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
               border-radius:12px;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px;color:#475569;font-size:12px;">Invite link</p>
            <p style="margin:0;color:#64748b;font-size:12px;word-break:break-all;">
              ${inviteLink}
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:24px 0 0;color:#334155;font-size:12px;line-height:1.6;">
        This invitation expires in <strong style="color:#475569;">7 days</strong>.
        If you don't have a HisabBoi account yet, you'll need to
        <strong style="color:#475569;">register first</strong> before accepting.
      </p>
    `,
  });

export const resetOtpEmailTemplate = ({
  firstName,
  code,
  expiresMinutes,
}: {
  firstName: string;
  code: string;
  expiresMinutes: number;
}) =>
  cashbookEmailBase({
    label: 'Password reset',
    title: `Hi <span style="color:#10b981;">${firstName}</span>, verify it's you`,
    bodyHtml: `
      <p style="margin:0 0 28px;color:#94a3b8;font-size:15px;line-height:1.7;">
        Enter this code on the reset page to choose a new password:
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <div style="background:rgba(16,185,129,0.08);border:1px dashed rgba(16,185,129,0.45);
                        border-radius:14px;padding:20px 0;display:block;">
              <span style="color:#10b981;font-size:38px;font-weight:800;letter-spacing:12px;
                           font-family:Georgia,serif;">${code}</span>
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px;color:#334155;font-size:13px;line-height:1.6;">
        This code expires in <strong style="color:#64748b;">${expiresMinutes} minutes</strong>.
        It can be used <strong style="color:#64748b;">5 times</strong> before it is invalidated.
      </p>
    `,
    footer:
      "If you didn't request a password reset, you can safely ignore this email — your password will not change.",
  });

// ── Notification templates ─────────────────────────────────────────────────

const escape = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

export const welcomeEmailTemplate = ({ firstName }: { firstName: string }) =>
  cashbookEmailBase({
    label: 'Welcome to HisabBoi',
    title: `Hi <span style="color:#10b981;">${escape(firstName)}</span>, welcome aboard`,
    bodyHtml: `
      <p style="margin:0 0 16px;color:#94a3b8;font-size:15px;line-height:1.7;">
        We're glad to have you. HisabBoi is built for small businesses that want
        to track every taka without the spreadsheet headache.
      </p>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.7;">
        To get started, create your first business and record an income or
        expense — it takes about a minute.
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding-bottom:8px;">
            <a href="https://hisabboi.vercel.app"
               style="background:#10b981;color:#022c22;text-decoration:none;
                      padding:14px 40px;border-radius:12px;font-weight:700;
                      font-size:15px;display:inline-block;letter-spacing:0.3px;">
              Open HisabBoi →
            </a>
          </td>
        </tr>
      </table>
    `,
  });

export const paymentReminderEmailTemplate = ({
  firstName,
  count,
  totalDue,
}: {
  firstName: string;
  count: number;
  totalDue: string;
}) =>
  cashbookEmailBase({
    label: 'Payment reminder',
    title: `You have <span style="color:#10b981;">${count}</span> pending payment${count === 1 ? '' : 's'}`,
    bodyHtml: `
      <p style="margin:0 0 20px;color:#94a3b8;font-size:15px;line-height:1.7;">
        Hi <strong style="color:#fff;">${escape(firstName)}</strong>, this is a friendly
        reminder that <strong style="color:#fff;">${count}</strong> sale${count === 1 ? '' : 's'} on
        your account still ${count === 1 ? 'has' : 'have'} an outstanding balance.
      </p>
      <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);
                  border-radius:12px;padding:20px 24px;margin:0 0 24px;">
        <p style="margin:0 0 4px;color:#fbbf24;font-size:12px;text-transform:uppercase;
                  letter-spacing:1px;">Total outstanding</p>
        <p style="margin:0;color:#fff;font-size:32px;font-weight:800;font-family:Georgia,serif;">
          ${escape(totalDue)}
        </p>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">
        Open the app to record payments and keep your books tidy.
      </p>
    `,
  });

export const monthlySummaryEmailTemplate = ({
  firstName,
  monthLabel,
  totalIncome,
  totalExpense,
  net,
}: {
  firstName: string;
  monthLabel: string;
  totalIncome: string;
  totalExpense: string;
  net: string;
}) =>
  cashbookEmailBase({
    label: `Your ${monthLabel} summary`,
    title: `Here's how <span style="color:#10b981;">${monthLabel}</span> went`,
    bodyHtml: `
      <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.7;">
        Hi <strong style="color:#fff;">${escape(firstName)}</strong>, here's your
        HisabBoi summary for <strong style="color:#fff;">${escape(monthLabel)}</strong>:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0"
        style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
               border-radius:12px;margin:0 0 24px;">
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Income</span>
            <p style="margin:4px 0 0;color:#10b981;font-size:20px;font-weight:700;">${escape(totalIncome)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Expense</span>
            <p style="margin:4px 0 0;color:#f87171;font-size:20px;font-weight:700;">${escape(totalExpense)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 20px;">
            <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Net</span>
            <p style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:800;">${escape(net)}</p>
          </td>
        </tr>
      </table>
    `,
  });

export const featureUpdateEmailTemplate = ({
  firstName,
  featureName,
  featureBlurb,
}: {
  firstName: string;
  featureName: string;
  featureBlurb: string;
}) =>
  cashbookEmailBase({
    label: "What's new",
    title: `Meet <span style="color:#10b981;">${escape(featureName)}</span>`,
    bodyHtml: `
      <p style="margin:0 0 20px;color:#94a3b8;font-size:15px;line-height:1.7;">
        Hi <strong style="color:#fff;">${escape(firstName)}</strong>, we just shipped something we
        think you'll love:
      </p>
      <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.18);
                  border-radius:12px;padding:18px 20px;margin:0 0 20px;">
        <p style="margin:0;color:#fff;font-size:16px;line-height:1.6;">${escape(featureBlurb)}</p>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">
        Open the app to try it out — your feedback shapes what we build next.
      </p>
    `,
  });

export const accountWarningEmailTemplate = ({
  firstName,
  reason,
  actionRequired,
}: {
  firstName: string;
  reason: string;
  actionRequired: string;
}) =>
  cashbookEmailBase({
    label: 'Action required',
    title: 'Heads up about your account',
    bodyHtml: `
      <p style="margin:0 0 16px;color:#94a3b8;font-size:15px;line-height:1.7;">
        Hi <strong style="color:#fff;">${escape(firstName)}</strong>, we need to flag
        something on your account:
      </p>
      <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);
                  border-radius:12px;padding:16px 20px;margin:0 0 18px;">
        <p style="margin:0;color:#fff;font-size:15px;line-height:1.6;">${escape(reason)}</p>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">
        <strong style="color:#fff;">What to do next:</strong>
        ${escape(actionRequired)}
      </p>
    `,
    footer:
      'If you think this is a mistake, reply to this email and our team will look into it.',
  });

// ── Template library (consumed by the admin panel) ─────────────────────────

export interface NotificationTemplateDef {
  id: string;
  label: string;
  description: string;
  preview: string;
  subject: string;
  bodyHtml: string;
  variables: { key: string; label: string; example: string }[];
  pushTitle: string;
  pushBody: string;
}

export const NOTIFICATION_TEMPLATES: NotificationTemplateDef[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    description: 'Greet new users right after they sign up.',
    preview: 'Hi {firstName}, welcome aboard',
    subject: 'Welcome to HisabBoi, {firstName}!',
    bodyHtml: welcomeEmailTemplate({ firstName: '{firstName}' }),
    variables: [
      { key: 'firstName', label: "Recipient's first name", example: 'Anika' },
    ],
    pushTitle: 'Welcome to HisabBoi',
    pushBody: "Hi {firstName}! Track your first taka in under a minute.",
  },
  {
    id: 'payment-reminder',
    label: 'Payment Reminder',
    description: 'Nudge users about outstanding sale balances.',
    preview: 'You have {count} pending payments',
    subject: 'You have {count} pending payment(s)',
    bodyHtml: paymentReminderEmailTemplate({
      firstName: '{firstName}',
      count: 3,
      totalDue: '{totalDue}',
    }),
    variables: [
      { key: 'firstName', label: "Recipient's first name", example: 'Anika' },
      { key: 'count', label: 'Number of pending sales', example: '3' },
      { key: 'totalDue', label: 'Total outstanding amount', example: '৳4,500' },
    ],
    pushTitle: 'Pending payments',
    pushBody: '{count} sale(s) still due — total {totalDue}',
  },
  {
    id: 'monthly-summary',
    label: 'Monthly Summary',
    description: "Recap the user's month in numbers.",
    preview: "Here's how {monthLabel} went",
    subject: 'Your HisabBoi summary — {monthLabel}',
    bodyHtml: monthlySummaryEmailTemplate({
      firstName: '{firstName}',
      monthLabel: '{monthLabel}',
      totalIncome: '{totalIncome}',
      totalExpense: '{totalExpense}',
      net: '{net}',
    }),
    variables: [
      { key: 'firstName', label: "Recipient's first name", example: 'Anika' },
      { key: 'monthLabel', label: 'Month label', example: 'October' },
      { key: 'totalIncome', label: 'Total income', example: '৳85,000' },
      { key: 'totalExpense', label: 'Total expense', example: '৳42,300' },
      { key: 'net', label: 'Net (income − expense)', example: '৳42,700' },
    ],
    pushTitle: '{monthLabel} summary',
    pushBody: 'Net {net} this month — tap to see the breakdown.',
  },
  {
    id: 'feature-update',
    label: 'Feature Update',
    description: 'Announce a new feature to the user base.',
    preview: 'Meet {featureName}',
    subject: 'New in HisabBoi: {featureName}',
    bodyHtml: featureUpdateEmailTemplate({
      firstName: '{firstName}',
      featureName: '{featureName}',
      featureBlurb: '{featureBlurb}',
    }),
    variables: [
      { key: 'firstName', label: "Recipient's first name", example: 'Anika' },
      { key: 'featureName', label: 'Feature name', example: 'AI Insights' },
      { key: 'featureBlurb', label: 'Short blurb', example: 'Ask HisabBoi anything about your books in plain Bangla.' },
    ],
    pushTitle: 'New: {featureName}',
    pushBody: '{featureBlurb}',
  },
  {
    id: 'account-warning',
    label: 'Account Warning',
    description: 'Flag a compliance / inactivity issue to a user.',
    preview: 'Heads up about your account',
    subject: 'Action required on your HisabBoi account',
    bodyHtml: accountWarningEmailTemplate({
      firstName: '{firstName}',
      reason: '{reason}',
      actionRequired: '{actionRequired}',
    }),
    variables: [
      { key: 'firstName', label: "Recipient's first name", example: 'Anika' },
      { key: 'reason', label: 'Why we are reaching out', example: 'We have not seen activity in 90 days.' },
      { key: 'actionRequired', label: 'What the user must do', example: 'Log in to keep your account active.' },
    ],
    pushTitle: 'Action required',
    pushBody: '{reason}',
  },
];

/**
 * Replace {variable} placeholders in subject/bodyHtml with values from `vars`.
 * Unknown placeholders are left intact so the admin can spot missing fields.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}