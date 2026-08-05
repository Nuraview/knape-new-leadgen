export const EMAIL_SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#000;">
  <tr>
    <td valign="top" style="padding-right:16px;">
      <img
        src="https://res.cloudinary.com/dliyoyws3/image/upload/fl_preserve_transparency/v1767880854/photo1-1_1_bho4el_xmnr6g.jpg"
        width="90"
        height="90"
        alt="Varshith KM"
        style="display:block;border-radius:50%;border:0;max-width:90px;height:auto;"
      />
    </td>
    <td valign="top">
      <div style="font-size:16px;font-weight:700;letter-spacing:0.3px;">
        VARSHITH KM
      </div>
      <div style="font-size:13px;color:#444;margin-top:2px;">
        CEO &amp; Founder, Nuraview
      </div>
      <div style="margin-top:8px;font-size:13px;">
        <a href="tel:+14788188340" style="color:#000;text-decoration:none;">
          +1 478 818 8340
        </a>
      </div>
      <div style="margin-top:6px;font-size:13px;">
        <a href="https://tidycal.com/vkumar" style="color:#000;text-decoration:underline;">
          Schedule a call
        </a>
      </div>
      <div style="margin:12px 0;border-top:1px solid #e5e5e5;width:260px;"></div>
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:8px;">
            <a href="https://www.linkedin.com/in/iamvarshith/">
              <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" width="18" alt="LinkedIn" style="display:block;border:0;" />
            </a>
          </td>
          <td>
            <a href="https://www.nuraview.com/">
              <img src="https://cdn-icons-png.flaticon.com/512/841/841364.png" width="18" alt="Website" style="display:block;border:0;" />
            </a>
          </td>
        </tr>
      </table>
      <div style="margin-top:6px;font-size:12.5px;color:#555;">
        <a href="https://www.linkedin.com/in/iamvarshith/" style="color:#000;text-decoration:none;">
          linkedin.com/in/iamvarshith
        </a>
        &nbsp;&bull;&nbsp;
        <a href="https://www.nuraview.com/" style="color:#000;text-decoration:none;">
          nuraview.com
        </a>
      </div>
      <div style="margin-top:10px;font-size:12px;color:#666;max-width:420px;line-height:1.4;">
        Nuraview, registered as Varshith KM LLC in Delaware, USA.<br/>
        1007 N Orange St. 4th Floor, Wilmington, DE, 19801
      </div>
    </td>
  </tr>
</table>
`.trim();

export const EMAIL_SIGNATURE_TEXT = `
--
VARSHITH KM
CEO & Founder, Nuraview
+1 478 818 8340
Schedule a call: https://tidycal.com/vkumar

linkedin.com/in/iamvarshith • nuraview.com

Nuraview, registered as Varshith KM LLC in Delaware, USA.
1007 N Orange St. 4th Floor, Wilmington, DE, 19801
`.trim();

export function wrapWithSignature(bodyHtml: string): string {
    return `${bodyHtml}<br/><br/>${EMAIL_SIGNATURE_HTML}`;
}

export function wrapTextWithSignature(bodyText: string): string {
    return `${bodyText}\n\n${EMAIL_SIGNATURE_TEXT}`;
}
