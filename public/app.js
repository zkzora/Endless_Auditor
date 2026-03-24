// ─── State ─────────────────────────────────────────────────────────────────
let editor = null;
let lastReport = null;

const EXAMPLE_CONTRACT = `module endless::vulnerable_token {
    use std::signer;
    use endless_framework::timestamp;

    struct TokenStore has key {
        balance: u64,
        owner: address,
    }

    struct AdminCap has key {
        admin: address,
    }

    // VULNERABILITY: Missing access control
    public fun init_admin(account: &signer) {
        let admin_cap = AdminCap {
            admin: signer::address_of(account),
        };
        move_to(account, admin_cap);
    }

    // VULNERABILITY: Missing acquires annotation
    public fun get_balance(addr: address): u64 {
        borrow_global<TokenStore>(addr).balance
    }

    // VULNERABILITY: Integer overflow - no checked arithmetic
    public fun add_balance(account: &signer, amount: u64) acquires TokenStore {
        let addr = signer::address_of(account);
        let store = borrow_global_mut<TokenStore>(addr);
        store.balance = store.balance + amount; // Can overflow!
    }

    // VULNERABILITY: Randomness from timestamp
    public fun random_airdrop(account: &signer) acquires TokenStore {
        let addr = signer::address_of(account);
        let store = borrow_global_mut<TokenStore>(addr);
        let random = timestamp::now_microseconds() % 1000;
        store.balance = store.balance + random;
    }

    // VULNERABILITY: No signer verification - can drain anyone's tokens
    public fun transfer(from: address, to: address, amount: u64) acquires TokenStore {
        let from_store = borrow_global_mut<TokenStore>(from);
        // Missing signer check!
        from_store.balance = from_store.balance - amount; // Can underflow!
        let to_store = borrow_global_mut<TokenStore>(to);
        to_store.balance = to_store.balance + amount;
    }

    // VULNERABILITY: Resource leak
    public fun create_store_unsafe(account: &signer, initial_balance: u64) {
        let store = TokenStore {
            balance: initial_balance,
            owner: signer::address_of(account),
        };
        if (initial_balance > 0) {
            move_to(account, store);
        }
        // else: store is dropped — RESOURCE LEAK!
    }

    // VULNERABILITY: Should be private
    public fun internal_reset_balance(account: &signer) acquires TokenStore {
        let addr = signer::address_of(account);
        let store = borrow_global_mut<TokenStore>(addr);
        store.balance = 0;
    }
}`;

// ─── Monaco Editor Init ─────────────────────────────────────────────────────
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  // Register Move language basics
  monaco.languages.register({ id: 'move' });
  monaco.languages.setMonarchTokensProvider('move', {
    keywords: ['module', 'use', 'fun', 'public', 'entry', 'struct', 'has', 'key', 'store', 'drop', 'copy',
      'let', 'if', 'else', 'while', 'loop', 'return', 'abort', 'move_to', 'move_from',
      'borrow_global', 'borrow_global_mut', 'exists', 'acquires', 'const', 'spec', 'invariant',
      'true', 'false', 'address', 'u8', 'u16', 'u32', 'u64', 'u128', 'u256', 'bool', 'vector'],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/".*?"/, 'string'],
        [/\b(0x[0-9a-fA-F]+|\d+)\b/, 'number'],
        [/\b(module|use|fun|public|entry|struct|has|key|store|drop|copy|let|if|else|while|loop|return|abort|move_to|move_from|borrow_global|borrow_global_mut|exists|acquires|const)\b/, 'keyword'],
        [/\b(u8|u16|u32|u64|u128|u256|bool|address|vector|signer)\b/, 'type'],
        [/\b(true|false)\b/, 'keyword'],
        [/[a-zA-Z_][\w]*/, 'identifier'],
        [/[{}()\[\];,.<>]/, 'delimiter'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    }
  });

  monaco.editor.defineTheme('endless-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '00ffb4', fontStyle: 'bold' },
      { token: 'type', foreground: '4d9fff' },
      { token: 'comment', foreground: '4a5568', fontStyle: 'italic' },
      { token: 'string', foreground: 'ffd166' },
      { token: 'number', foreground: 'ff8c42' },
      { token: 'identifier', foreground: 'c9d8e8' },
    ],
    colors: {
      'editor.background': '#080b12',
      'editor.foreground': '#c9d8e8',
      'editor.lineHighlightBackground': '#0d1120',
      'editorLineNumber.foreground': '#2d3748',
      'editorLineNumber.activeForeground': '#00ffb4',
      'editor.selectionBackground': '#00ffb420',
      'editorCursor.foreground': '#00ffb4',
      'scrollbarSlider.background': '#ffffff15',
    }
  });

  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '',
    language: 'move',
    theme: 'endless-dark',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    wordWrap: 'on',
    automaticLayout: true,
    padding: { top: 16, bottom: 16 },
    renderLineHighlight: 'line',
    cursorBlinking: 'phase',
    smoothScrolling: true,
    placeholder: '// Paste your Move smart contract here...',
  });

  editor.onDidChangeModelContent(updateMeta);
  updateMeta();
  checkAPIHealth();
});

function updateMeta() {
  const val = editor ? editor.getValue() : '';
  const lines = val.split('\n').length;
  const chars = val.length;
  document.getElementById('code-meta').textContent = `Lines: ${lines} | Chars: ${chars.toLocaleString()}`;
}

// ─── API Health Check ───────────────────────────────────────────────────────
async function checkAPIHealth() {
  const dot = document.getElementById('api-status');
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      dot.style.background = '#00ffb4';
      dot.style.boxShadow = '0 0 8px #00ffb4';
      dot.title = 'API Online';
    } else {
      dot.style.background = '#ff4d6a';
      dot.title = 'API Error';
    }
  } catch {
    dot.style.background = '#ff8c42';
    dot.title = 'API Unreachable';
  }
}

// ─── Load Example ───────────────────────────────────────────────────────────
document.getElementById('btn-load-example').addEventListener('click', () => {
  if (editor) {
    editor.setValue(EXAMPLE_CONTRACT);
    editor.setScrollPosition({ scrollTop: 0 });
    showToast('Example contract loaded!', '📋');
  }
});

// ─── Clear ──────────────────────────────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('click', () => {
  if (editor) {
    editor.setValue('');
    resetResults();
  }
});

// ─── Start Audit ────────────────────────────────────────────────────────────
async function startAudit() {
  const code = editor ? editor.getValue().trim() : '';
  if (!code) {
    showToast('Please paste a Move contract first', '⚠️');
    return;
  }

  setLoading(true);
  showLoadingState();

  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      showError(data.error || 'Audit failed. Please try again.');
      return;
    }

    lastReport = data;
    renderReport(data);
    showToast(`Audit complete! ${data.totalFindings || 0} findings`, '🔍');

  } catch (err) {
    showError('Network error. Is the server running?');
    console.error(err);
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  const btn = document.getElementById('btn-audit');
  const icon = document.getElementById('audit-btn-icon');
  const text = document.getElementById('audit-btn-text');
  btn.disabled = loading;
  if (loading) {
    icon.textContent = '⏳';
    text.textContent = 'Analyzing...';
  } else {
    icon.textContent = '🔍';
    text.textContent = 'Audit Contract';
  }
}

function showLoadingState() {
  document.getElementById('empty-state') && (document.getElementById('empty-state').style.display = 'none');
  document.getElementById('export-bar').classList.remove('visible');
  document.getElementById('findings-count').textContent = '';

  document.getElementById('results-content').innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p style="color:var(--text-secondary);font-size:0.9rem;font-weight:600;margin-bottom:8px;">Analyzing your Move contract...</p>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:20px;">Gemini AI is reviewing 15+ vulnerability types</p>
      <div class="loading-steps">
        <div class="loading-step"><span>🔍</span> Parsing contract structure</div>
        <div class="loading-step"><span>🛡️</span> Checking access controls</div>
        <div class="loading-step"><span>⚡</span> Detecting arithmetic issues</div>
        <div class="loading-step"><span>📋</span> Generating report</div>
      </div>
    </div>`;
}

function resetResults() {
  lastReport = null;
  document.getElementById('findings-count').textContent = '';
  document.getElementById('export-bar').classList.remove('visible');
  document.getElementById('results-content').innerHTML = `
    <div class="empty-state" id="empty-state">
      <span class="icon">🛡️</span>
      <p>Your audit report will appear here.<br>
      Paste a Move contract or <strong>Load Example</strong> and click <code>Audit Contract</code>.</p>
    </div>`;
}

function showError(msg) {
  document.getElementById('results-content').innerHTML = `
    <div style="padding:40px 20px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:16px;">❌</div>
      <p style="color:var(--red);font-weight:600;margin-bottom:8px;">Audit Failed</p>
      <p style="color:var(--text-secondary);font-size:0.85rem;">${escapeHtml(msg)}</p>
      <button onclick="startAudit()" class="btn btn-ghost" style="margin-top:20px;">Try Again</button>
    </div>`;
  showToast(msg, '❌');
}

// ─── Render Report ──────────────────────────────────────────────────────────
function renderReport(report) {
  const container = document.getElementById('results-content');
  const findings = report.findings || [];
  const sevOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'];
  const sorted = [...findings].sort((a, b) =>
    sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
  );

  // Update header count
  document.getElementById('findings-count').textContent =
    `${findings.length} finding${findings.length !== 1 ? 's' : ''}`;

  // Score color
  const score = report.riskScore ?? 0;
  const scoreColor = score >= 70 ? 'var(--red)' : score >= 40 ? 'var(--orange)' : score >= 20 ? 'var(--yellow)' : 'var(--accent)';
  const circumference = 2 * Math.PI * 34;
  const dashOffset = circumference - (score / 100) * circumference;

  // Count by severity
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFORMATIONAL: 0 };
  findings.forEach(f => { if (counts[f.severity] !== undefined) counts[f.severity]++; });

  let html = `
    <div class="score-section">
      <div class="score-gauge">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="6"/>
          <circle cx="40" cy="40" r="34" fill="none" stroke="${scoreColor}" stroke-width="6"
            stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
            stroke-linecap="round"
            style="transition: stroke-dashoffset 1.2s cubic-bezier(0.34,1.56,0.64,1); filter: drop-shadow(0 0 6px ${scoreColor})"/>
        </svg>
        <div class="score-text">
          <div class="score-num" style="color:${scoreColor}">${score}</div>
          <div class="score-label">Risk</div>
        </div>
      </div>
      <div class="score-meta">
        <h3>${escapeHtml(report.contractName || 'Unknown Contract')}</h3>
        <p>${escapeHtml(report.summary || '')}</p>
        <div class="score-stats">
          ${counts.CRITICAL ? `<div class="stat"><div class="stat-num" style="color:var(--red)">${counts.CRITICAL}</div><div class="stat-label">Critical</div></div>` : ''}
          ${counts.HIGH ? `<div class="stat"><div class="stat-num" style="color:var(--orange)">${counts.HIGH}</div><div class="stat-label">High</div></div>` : ''}
          ${counts.MEDIUM ? `<div class="stat"><div class="stat-num" style="color:var(--yellow)">${counts.MEDIUM}</div><div class="stat-label">Medium</div></div>` : ''}
          ${counts.LOW ? `<div class="stat"><div class="stat-num" style="color:var(--blue)">${counts.LOW}</div><div class="stat-label">Low</div></div>` : ''}
          ${counts.INFORMATIONAL ? `<div class="stat"><div class="stat-num" style="color:var(--gray)">${counts.INFORMATIONAL}</div><div class="stat-label">Info</div></div>` : ''}
          ${findings.length === 0 ? `<div class="stat"><div class="stat-num" style="color:var(--accent)">0</div><div class="stat-label">Issues</div></div>` : ''}
        </div>
      </div>
    </div>`;

  if (sorted.length > 0) {
    html += `<div class="findings-header">
      <h4>Security Findings</h4>
    </div>`;
    sorted.forEach((f, i) => {
      const sevClass = (f.severity || 'INFORMATIONAL').toLowerCase();
      html += `
        <div class="finding-card ${sevClass}" id="finding-${i}">
          <div class="finding-header" onclick="toggleFinding(${i})">
            <span class="sev-badge ${sevClass}">${f.severity || 'INFO'}</span>
            <span class="finding-title">${escapeHtml(f.title || 'Finding')}</span>
            <span class="finding-id">${escapeHtml(f.id || '')}</span>
            <span class="finding-chevron">›</span>
          </div>
          <div class="finding-body">
            <div class="finding-row">
              <div class="finding-row-label">Category</div>
              <div class="finding-row-value">${escapeHtml(f.category || '')}</div>
            </div>
            <div class="finding-row">
              <div class="finding-row-label">Description</div>
              <div class="finding-row-value">${escapeHtml(f.description || '')}</div>
            </div>
            ${f.location?.code ? `
            <div class="finding-row">
              <div class="finding-row-label">Code ${f.location.line ? `(~Line ${f.location.line})` : ''}</div>
              <div class="code-snippet">${escapeHtml(f.location.code)}</div>
            </div>` : ''}
            <div class="finding-row">
              <div class="finding-row-label">Impact</div>
              <div class="finding-row-value">${escapeHtml(f.impact || '')}</div>
            </div>
            <div class="finding-row">
              <div class="finding-row-label">Recommendation</div>
              <div class="recommendation-box">${escapeHtml(f.recommendation || '')}</div>
            </div>
          </div>
        </div>`;
    });
  } else {
    html += `<div style="text-align:center;padding:30px;color:var(--accent);">
      <div style="font-size:2.5rem;margin-bottom:12px;">✅</div>
      <p style="font-weight:600;font-size:1rem;margin-bottom:6px;">No Issues Found</p>
      <p style="color:var(--text-muted);font-size:0.82rem;">This contract appears to be secure based on AI analysis.</p>
    </div>`;
  }

  // Gas analysis
  if (report.gasAnalysis) {
    html += `<div style="margin-top:12px;padding:12px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);">
      <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px;">Gas Complexity</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="sev-badge ${report.gasAnalysis.complexity === 'HIGH' ? 'high' : report.gasAnalysis.complexity === 'MEDIUM' ? 'medium' : 'low'}">${report.gasAnalysis.complexity}</span>
        <span style="font-size:0.82rem;color:var(--text-secondary);">${escapeHtml(report.gasAnalysis.notes || '')}</span>
      </div>
    </div>`;
  }

  // Positives
  if (report.positives && report.positives.length > 0) {
    html += `<div class="positives-section">
      <h4>✅ Security Positives</h4>
      ${report.positives.map(p => `<div class="positive-item">${escapeHtml(p)}</div>`).join('')}
    </div>`;
  }

  // Metadata
  if (report.auditedAt) {
    html += `<div style="font-size:0.72rem;color:var(--text-muted);text-align:right;margin-top:12px;">
      Audited: ${new Date(report.auditedAt).toLocaleString()} &nbsp;|&nbsp; ${report.lineCount} lines &nbsp;|&nbsp; ${(report.codeLength||0).toLocaleString()} chars
    </div>`;
  }

  html += `<div class="disclaimer">⚠️ ${escapeHtml(report.disclaimer || 'AI-generated audit. Review by a human expert before production deployment.')}</div>`;

  container.innerHTML = html;
  document.getElementById('export-bar').classList.add('visible');

  // Animate score gauge (re-trigger)
  setTimeout(() => {
    const circle = container.querySelector('circle:nth-child(2)');
    if (circle) {
      circle.style.strokeDashoffset = circumference;
      setTimeout(() => { circle.style.strokeDashoffset = dashOffset; }, 50);
    }
  }, 100);
}

function toggleFinding(i) {
  const card = document.getElementById(`finding-${i}`);
  card.classList.toggle('open');
}

// ─── Export ─────────────────────────────────────────────────────────────────
function exportMarkdown() {
  if (!lastReport) return;
  const r = lastReport;
  let md = `# Smart Contract Audit Report\n\n`;
  md += `**Contract:** ${r.contractName || 'Unknown'}\n`;
  md += `**Risk Score:** ${r.riskScore}/100 (${r.riskLevel})\n`;
  md += `**Audited:** ${r.auditedAt ? new Date(r.auditedAt).toLocaleString() : 'N/A'}\n\n`;
  md += `## Summary\n${r.summary || ''}\n\n`;
  if (r.findings?.length) {
    md += `## Findings (${r.findings.length})\n\n`;
    r.findings.forEach(f => {
      md += `### ${f.id} — ${f.title}\n`;
      md += `**Severity:** ${f.severity} | **Category:** ${f.category}\n\n`;
      md += `${f.description}\n\n`;
      if (f.location?.code) md += `\`\`\`move\n${f.location.code}\n\`\`\`\n\n`;
      md += `**Impact:** ${f.impact}\n\n`;
      md += `**Recommendation:** ${f.recommendation}\n\n---\n\n`;
    });
  }
  md += `> ${r.disclaimer}`;
  downloadText(md, `audit-report-${Date.now()}.md`, 'text/markdown');
  showToast('Markdown exported!', '📄');
}

function exportJSON() {
  if (!lastReport) return;
  downloadText(JSON.stringify(lastReport, null, 2), `audit-report-${Date.now()}.json`, 'application/json');
  showToast('JSON exported!', '{ }');
}

async function copyReport() {
  if (!lastReport) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
    showToast('Report copied to clipboard!', '📋');
  } catch {
    showToast('Copy failed — try Export JSON', '⚠️');
  }
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, icon = '✅') {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast-icon').textContent = icon;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
