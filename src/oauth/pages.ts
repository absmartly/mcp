import { SCOPE_DESCRIPTIONS } from "./constants.js";
import { escapeHtml } from "./html.js";

const PAGE_STYLE_BASE = `body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 8px; font-size: 24px; color: #1a1a1a; }`;
const DEFAULT_ACCOUNT_LABEL = "your ABsmartly account";

export type ConsentPageOptions = {
  formAction: string;
  transactionId: string;
  clientName: string;
  scopes: string[];
  redirectTarget: string;
  // The ABsmartly instance being connected, when the server serves many (the worker).
  accountLabel?: string;
  // Extra warning for loopback redirects: any local app can claim a loopback callback.
  loopbackRedirect?: boolean;
};

function describeScope(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] || scope;
}

export function renderEndpointForm(formAction: string, transactionId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ABsmartly MCP - Connect</title>
  <style>
    ${PAGE_STYLE_BASE}
    p { color: #666; margin: 0 0 24px; font-size: 14px; line-height: 1.5; }
    label { display: block; font-weight: 600; margin-bottom: 8px; color: #333; font-size: 14px; }
    input[type="url"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; box-sizing: border-box; }
    input[type="url"]:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    button { width: 100%; padding: 12px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 16px; }
    button:hover { background: #4338ca; }
    .hint { font-size: 12px; color: #999; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to ABsmartly</h1>
    <p>Enter your ABsmartly instance URL to continue the authorization flow.</p>
    <form method="POST" action="${escapeHtml(formAction)}" id="endpoint-form">
      <input type="hidden" name="action" value="set_endpoint">
      <input type="hidden" name="transaction_id" value="${escapeHtml(transactionId)}">
      <label for="absmartly_endpoint">ABsmartly URL</label>
      <input type="url" id="absmartly_endpoint" name="absmartly_endpoint" placeholder="https://your-instance.absmartly.com" required>
      <div class="hint">Example: https://your-company.absmartly.com</div>
      <button type="submit">Continue</button>
    </form>
  </div>
  <script>
    var inp = document.getElementById('absmartly_endpoint');
    inp.addEventListener('input', function() {
      var v = this.value.trim();
      if (v && !v.startsWith('http://') && !v.startsWith('https://') && !v.startsWith('h')) {
        this.value = 'https://' + v;
      }
    });
    document.getElementById('endpoint-form').addEventListener('submit', function() {
      var v = inp.value.trim().replace(/\\/+$/, '');
      if (v && !v.startsWith('http://') && !v.startsWith('https://')) {
        v = 'https://' + v;
      }
      inp.value = v;
    });
  </script>
</body>
</html>`;
}

export function renderConsentPage(options: ConsentPageOptions): string {
  const scopeListHtml = options.scopes.map((s) => `<li>${escapeHtml(describeScope(s))}</li>`).join("");
  const account = options.accountLabel ? `your account at <strong>${escapeHtml(options.accountLabel)}</strong>` : DEFAULT_ACCOUNT_LABEL;
  const loopbackWarning = options.loopbackRedirect
    ? `<p class="warning">The access will be delivered to an app running on this computer. Only continue if you just started this connection from your own MCP client.</p>`
    : "";
  const formAction = escapeHtml(options.formAction);
  const transactionId = escapeHtml(options.transactionId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ABsmartly MCP - Authorize</title>
  <style>
    ${PAGE_STYLE_BASE}
    p { color: #666; margin: 0 0 16px; font-size: 14px; line-height: 1.5; }
    .client-name { font-weight: 600; color: #1a1a1a; }
    ul { padding-left: 20px; margin: 0 0 24px; }
    li { color: #444; margin-bottom: 8px; font-size: 14px; }
    .actions { display: flex; gap: 12px; }
    button { flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
    .approve { background: #4f46e5; color: white; }
    .approve:hover { background: #4338ca; }
    .cancel { background: #f3f4f6; color: #374151; }
    .cancel:hover { background: #e5e7eb; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; color: #78350f; word-break: break-word; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize Access</h1>
    <p><span class="client-name">${escapeHtml(options.clientName)}</span> is requesting access to your ABsmartly account.</p>
    <p class="warning">After you approve, access to ${account} will be sent to <strong>${escapeHtml(options.redirectTarget)}</strong>. Only continue if you started this connection yourself and you trust that site.</p>
    ${loopbackWarning}
    <p>This application will be able to:</p>
    <ul>${scopeListHtml}</ul>
    <div class="actions">
      <form method="POST" action="${formAction}" style="flex:1;display:flex;">
        <input type="hidden" name="action" value="cancel">
        <input type="hidden" name="transaction_id" value="${transactionId}">
        <button type="submit" class="cancel" style="width:100%;">Deny</button>
      </form>
      <form method="POST" action="${formAction}" style="flex:1;display:flex;">
        <input type="hidden" name="action" value="approve">
        <input type="hidden" name="transaction_id" value="${transactionId}">
        <button type="submit" class="approve" style="width:100%;">Approve</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}
