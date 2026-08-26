/**
 * HTML email templates for each EmailTemplate type (task S11a).
 * Provides a consistent, professional look for all notification emails.
 * Each template wraps content in a responsive HTML email shell.
 */

const APP_NAME = 'Agency CRM';
const BRAND_COLOR = '#2563eb';
const TEXT_COLOR = '#1f2937';
const MUTED_COLOR = '#6b7280';

interface TemplateContext {
  headline: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

function baseLayout(ctx: TemplateContext): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(ctx.headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${APP_NAME}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px 0;color:${TEXT_COLOR};font-size:18px;font-weight:600;">${escapeHtml(ctx.headline)}</h2>
              <div style="color:${TEXT_COLOR};font-size:15px;line-height:1.6;">
                ${ctx.bodyHtml}
              </div>
              ${ctx.ctaLabel && ctx.ctaUrl ? `
              <table cellpadding="0" cellspacing="0" style="margin-top:24px;">
                <tr>
                  <td style="background-color:${BRAND_COLOR};border-radius:6px;">
                    <a href="${escapeHtml(ctx.ctaUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(ctx.ctaLabel)}</a>
                  </td>
                </tr>
              </table>` : ''}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:${MUTED_COLOR};font-size:12px;">${APP_NAME} — Creative approval workflow</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Template renderers
// ---------------------------------------------------------------------------

export function renderVersionNew(input: {
  creativeTitle: string;
  versionNo: number;
  reviewUrl?: string;
}): string {
  return baseLayout({
    headline: `New version: "${input.creativeTitle}" v${input.versionNo}`,
    bodyHtml: `<p>A new version (v${input.versionNo}) of "<strong>${escapeHtml(input.creativeTitle)}</strong>" has been uploaded and is ready for your review.</p>
<p>Please review and approve or request changes.</p>`,
    ctaLabel: 'Review now',
    ctaUrl: input.reviewUrl,
  });
}

export function renderCommentNew(input: {
  creativeTitle: string;
  versionNo: number;
  authorLabel: string;
  commentBody: string;
  reviewUrl?: string;
}): string {
  return baseLayout({
    headline: `New comment on "${input.creativeTitle}" v${input.versionNo}`,
    bodyHtml: `<p><strong>${escapeHtml(input.authorLabel)}</strong> commented on version v${input.versionNo} of "<strong>${escapeHtml(input.creativeTitle)}</strong>":</p>
<blockquote style="margin:16px 0;padding:12px 16px;background-color:#f9fafb;border-left:4px solid ${BRAND_COLOR};color:${TEXT_COLOR};font-style:italic;">${escapeHtml(input.commentBody)}</blockquote>`,
    ctaLabel: 'View comment',
    ctaUrl: input.reviewUrl,
  });
}

export function renderDecisionCast(input: {
  creativeTitle: string;
  versionNo: number;
  decision: string;
  actorLabel: string;
  reviewUrl?: string;
}): string {
  const decisionLabel =
    input.decision === 'APPROVED'
      ? 'approved'
      : input.decision === 'REJECTED'
        ? 'rejected'
        : 'requested changes on';

  const decisionColor =
    input.decision === 'APPROVED'
      ? '#16a34a'
      : input.decision === 'REJECTED'
        ? '#dc2626'
        : '#d97706';

  return baseLayout({
    headline: `Version "${input.creativeTitle}" v${input.versionNo} ${decisionLabel}`,
    bodyHtml: `<p><strong>${escapeHtml(input.actorLabel)}</strong> has <span style="color:${decisionColor};font-weight:600;">${decisionLabel}</span> version v${input.versionNo} of "<strong>${escapeHtml(input.creativeTitle)}</strong>".</p>`,
    ctaLabel: 'View details',
    ctaUrl: input.reviewUrl,
  });
}

export function renderApprovalReminder(input: {
  creativeTitle: string;
  versionNo: number;
  daysPending: number;
  reviewUrl?: string;
}): string {
  return baseLayout({
    headline: `Reminder: "${input.creativeTitle}" v${input.versionNo} awaiting approval`,
    bodyHtml: `<p>This is a reminder that version v${input.versionNo} of "<strong>${escapeHtml(input.creativeTitle)}</strong>" has been pending approval for <strong>${input.daysPending} days</strong>.</p>
<p>Please review and approve or request changes.</p>`,
    ctaLabel: 'Review now',
    ctaUrl: input.reviewUrl,
  });
}

export function renderWeeklyDigest(input: {
  agencyName: string;
  pendingVersions: Array<{
    creativeTitle: string;
    versionNo: number;
    daysPending: number;
  }>;
  reviewBaseUrl?: string;
}): string {
  const versionRows = input.pendingVersions
    .map(
      (v) => `<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(v.creativeTitle)}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">v${v.versionNo}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${v.daysPending}d</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;"><a href="${escapeHtml(input.reviewBaseUrl ?? '#')}" style="color:${BRAND_COLOR};text-decoration:none;">Review</a></td>
</tr>`,
    )
    .join('\n');

  return baseLayout({
    headline: `Weekly digest: ${input.pendingVersions.length} version(s) pending`,
    bodyHtml: `<p>Hi,</p>
<p>Here's your weekly summary for <strong>${escapeHtml(input.agencyName)}</strong>:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
  <thead>
    <tr style="background-color:#f9fafb;">
      <th style="padding:8px 12px;text-align:left;font-size:13px;color:${MUTED_COLOR};">Creative</th>
      <th style="padding:8px 12px;text-align:center;font-size:13px;color:${MUTED_COLOR};">Version</th>
      <th style="padding:8px 12px;text-align:center;font-size:13px;color:${MUTED_COLOR};">Pending</th>
      <th style="padding:8px 12px;text-align:left;font-size:13px;color:${MUTED_COLOR};">Action</th>
    </tr>
  </thead>
  <tbody>
    ${versionRows}
  </tbody>
</table>
<p style="color:${MUTED_COLOR};font-size:13px;">Login to your dashboard to manage approvals.</p>`,
  });
}

/**
 * Render an email template by type. Used by SmtpEmailTransport when the
 * NotificationsService queue methods provide pre-rendered HTML, but this
 * can also be called directly for digest/reminder batches.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  switch (template) {
    case 'VERSION_NEW':
      return renderVersionNew(vars as { creativeTitle: string; versionNo: number; reviewUrl?: string });
    case 'COMMENT_NEW':
      return renderCommentNew(vars as { creativeTitle: string; versionNo: number; authorLabel: string; commentBody: string; reviewUrl?: string });
    case 'DECISION_CAST':
      return renderDecisionCast(vars as { creativeTitle: string; versionNo: number; decision: string; actorLabel: string; reviewUrl?: string });
    case 'APPROVAL_REMINDER':
      return renderApprovalReminder(vars as { creativeTitle: string; versionNo: number; daysPending: number; reviewUrl?: string });
    case 'WEEKLY_DIGEST':
      return renderWeeklyDigest(vars as { agencyName: string; pendingVersions: Array<{ creativeTitle: string; versionNo: number; daysPending: number }>; reviewBaseUrl?: string });
    default:
      return `<p>${escapeHtml(String(vars.bodyText ?? 'No content'))}</p>`;
  }
}
