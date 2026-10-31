import { esc } from '../http-helpers.js';
import { layout } from './layout.js';

export function renderApiKeys({ keys, newKey, flash }) {
  const rows = keys.map((k) => `
    <tr>
      <td>${esc(k.label) || '&mdash;'}</td>
      <td>${esc(k.created_at)}</td>
      <td>${esc(k.last_used_at) || 'never'}</td>
      <td>
        <form method="post" action="/settings/api-keys/${k.id}/delete" onsubmit="return confirm('Revoke this key? Any integration using it will stop working.')">
          <button class="btn btn-tiny btn-danger" type="submit">Revoke</button>
        </form>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">No API keys yet.</td></tr>';

  const newKeyBanner = newKey ? `
    <div class="card" style="border-color:#2f7a3d;background:#f0faf1;margin-bottom:1.5rem;">
      <h3>New API key created</h3>
      <p>Copy this now — it will not be shown again:</p>
      <code class="key-display">${esc(newKey)}</code>
      <p class="muted">Send it as header <code>X-API-Key: ${esc(newKey)}</code> (or <code>Authorization: Bearer ${esc(newKey)}</code>) when calling <code>/api/v1/*</code> from your other app.</p>
    </div>
  ` : '';

  const body = `
    <div class="page-header">
      <h1>API Keys</h1>
    </div>
    <p class="muted">Keys here authenticate external calls to <code>/api/v1/*</code> &mdash; use one from your other app to pull or push CRM data.</p>

    ${newKeyBanner}

    <table class="data-table">
      <thead><tr><th>Label</th><th>Created</th><th>Last used</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="card" style="max-width:480px;margin-top:1.5rem;">
      <h3>Create a new key</h3>
      <form class="form-grid" method="post" action="/settings/api-keys">
        <label class="full-width">Label<input type="text" name="label" placeholder="e.g. Main App integration"></label>
        <div class="full-width form-actions">
          <button class="btn btn-primary" type="submit">Generate key</button>
        </div>
      </form>
    </div>
  `;
  return layout({ title: 'API Keys', active: '/settings/api-keys', body, flash });
}
