// utils/emailTemplates.ts

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
}) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>You're invited to ${businessName}</title>
</head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
          style="background:#0d1424;border-radius:20px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(16,185,129,0.03));
                       padding:32px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="background:#10b981;width:36px;height:36px;border-radius:10px;
                                display:inline-flex;align-items:center;justify-content:center;
                                vertical-align:middle;margin-right:10px;">
                      <span style="color:#022c22;font-size:18px;font-weight:900;line-height:1;">₿</span>
                    </div>
                    <span style="color:#fff;font-size:20px;font-weight:700;
                                 font-family:Georgia,serif;vertical-align:middle;">CashBook</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 6px;color:#64748b;font-size:12px;text-transform:uppercase;
                         letter-spacing:1px;">You have an invitation</p>
              <h1 style="margin:0 0 20px;color:#fff;font-size:26px;font-family:Georgia,serif;
                          font-weight:700;line-height:1.3;">
                Join <span style="color:#10b981;">${businessName}</span>
              </h1>

              <p style="margin:0 0 28px;color:#94a3b8;font-size:15px;line-height:1.7;">
                <strong style="color:#fff;">${inviterName}</strong> has invited you to collaborate
                on <strong style="color:#fff;">${businessName}</strong> as a
                <span style="background:rgba(16,185,129,0.12);color:#10b981;
                             padding:2px 10px;border-radius:20px;font-size:13px;font-weight:600;">
                  ${role}
                </span>.
              </p>

              <!-- CTA -->
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

              <!-- Info box -->
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
                If you don't have a CashBook account yet, you'll need to
                <strong style="color:#475569;">register first</strong> before accepting.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.05);">
              <p style="margin:0;color:#1e293b;font-size:11px;">
                If you weren't expecting this, you can safely ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
