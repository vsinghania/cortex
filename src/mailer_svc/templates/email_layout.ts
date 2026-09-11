const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const SAFE_LINK_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * The shared shell every email renders into. Inline styles and a table layout,
 * because most mail clients strip <style> blocks and ignore flexbox.
 */
export class EmailLayout {
  private constructor() {}

  /** Anything interpolated into HTML that is not a literal in a template goes through here. */
  static escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
  }

  static paragraph(text: string): string {
    return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2933;">${EmailLayout.escapeHtml(text)}</p>`;
  }

  /** A styled link rather than a <button>, which many clients refuse to render. */
  static button(params: { href: string; label: string }): string {
    EmailLayout.assertSafeLink(params.href);
    return (
      `<p style="margin:24px 0;">` +
      `<a href="${EmailLayout.escapeHtml(params.href)}" ` +
      `style="display:inline-block;padding:12px 20px;border-radius:6px;background:#1f2933;` +
      `color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">` +
      `${EmailLayout.escapeHtml(params.label)}</a></p>`
    );
  }

  /**
   * `body_html` is trusted as-is: build it from the helpers above. The preheader is
   * the grey preview line inbox lists show after the subject.
   */
  static wrap(params: { title: string; body_html: string; preheader?: string }): string {
    const title = EmailLayout.escapeHtml(params.title);
    const preheader = params.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;">${EmailLayout.escapeHtml(params.preheader)}</div>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td>
<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#1f2933;">cortex</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#1f2933;">${title}</h1>
${params.body_html}
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#7b8794;">Sent by Cortex</p>
</td></tr>
</table>
</body>
</html>`;
  }

  private static assertSafeLink(href: string): void {
    const protocol = URL.canParse(href) ? new URL(href).protocol : null;
    if (!protocol || !SAFE_LINK_PROTOCOLS.has(protocol)) {
      throw new Error('email links must be absolute http(s) URLs');
    }
  }
}
