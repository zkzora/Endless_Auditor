#!/usr/bin/env node
/**
 * Endless Auditor — CLI Tool
 * Audit Move smart contracts directly from your terminal.
 *
 * Usage:
 *   node cli/audit.js <contract-file> [options]
 *
 * Options:
 *   --output <file>     Save report to file (.json or .md)
 *   --format <type>     Output format: markdown (default) or json
 *   --model <model>     Override OpenRouter model
 *   --help              Show help
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai').default;
const { buildAuditPrompt } = require('../prompts/audit-prompt');

// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  orange: '\x1b[33m',
  yellow: '\x1b[93m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

const SEV_COLORS = {
  CRITICAL:      c.red,
  HIGH:          c.orange,
  MEDIUM:        c.yellow,
  LOW:           c.blue,
  INFORMATIONAL: c.gray,
};

const SEV_ICONS = {
  CRITICAL:      '🔴',
  HIGH:          '🟠',
  MEDIUM:        '🟡',
  LOW:           '🔵',
  INFORMATIONAL: '⚪',
};

const RISK_COLORS = {
  CRITICAL: c.red,
  HIGH:     c.orange,
  MEDIUM:   c.yellow,
  LOW:      c.green,
  SAFE:     c.green,
};

// ─── Parse Args ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { file: null, output: null, format: 'markdown', model: null, help: false };
  const raw = argv.slice(2);

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--help' || raw[i] === '-h') { args.help = true; }
    else if (raw[i] === '--output' || raw[i] === '-o') { args.output = raw[++i]; }
    else if (raw[i] === '--format' || raw[i] === '-f') { args.format = raw[++i]; }
    else if (raw[i] === '--model' || raw[i] === '-m') { args.model = raw[++i]; }
    else if (!raw[i].startsWith('--')) { args.file = raw[i]; }
  }
  return args;
}

// ─── Help ─────────────────────────────────────────────────────────────────────
function showHelp() {
  console.log(`
${c.bold}${c.cyan}🔒 Endless Auditor — CLI${c.reset}
${c.dim}AI-powered Move smart contract security auditor${c.reset}

${c.bold}Usage:${c.reset}
  node cli/audit.js ${c.cyan}<contract.move>${c.reset} [options]

${c.bold}Options:${c.reset}
  ${c.cyan}--output, -o${c.reset} <file>    Save report to file (supports .json and .md)
  ${c.cyan}--format, -f${c.reset} <type>    Output format: ${c.bold}markdown${c.reset} (default) | ${c.bold}json${c.reset}
  ${c.cyan}--model,  -m${c.reset} <model>   Override OpenRouter model (see README for options)
  ${c.cyan}--help,   -h${c.reset}           Show this help

${c.bold}Examples:${c.reset}
  node cli/audit.js samples/example.move
  node cli/audit.js contract.move --output report.md
  node cli/audit.js contract.move --format json --output report.json
  node cli/audit.js contract.move --model anthropic/claude-3-5-haiku

${c.bold}Models (set in .env or via --model):${c.reset}
  google/gemini-2.0-flash-001     ⭐ Default — fast & accurate
  anthropic/claude-3-5-haiku      Great code analysis
  openai/gpt-4o-mini              Cost-effective
  deepseek/deepseek-r1            Strong reasoning

${c.dim}Tip: Set OPENROUTER_API_KEY and OPENROUTER_MODEL in your .env file${c.reset}
`);
}

// ─── Separator ─────────────────────────────────────────────────────────────────
function sep(char = '─', len = 56) {
  return c.dim + char.repeat(len) + c.reset;
}

// ─── Markdown Report Builder ──────────────────────────────────────────────────
function buildMarkdown(report, filePath) {
  const date = report.auditedAt ? new Date(report.auditedAt).toLocaleString() : 'N/A';
  let md = `# 🔒 Endless Auditor — Security Report\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| **Contract** | \`${report.contractName || 'Unknown'}\` |\n`;
  md += `| **File** | \`${filePath}\` |\n`;
  md += `| **Risk Score** | ${report.riskScore}/100 (${report.riskLevel}) |\n`;
  md += `| **Findings** | ${report.totalFindings || 0} |\n`;
  md += `| **Model** | \`${report.model || 'N/A'}\` |\n`;
  md += `| **Audited** | ${date} |\n\n`;

  md += `## Summary\n${report.summary || ''}\n\n`;

  if (report.findings?.length) {
    md += `## Findings\n\n`;
    const order = ['CRITICAL','HIGH','MEDIUM','LOW','INFORMATIONAL'];
    const sorted = [...report.findings].sort((a,b) => order.indexOf(a.severity) - order.indexOf(b.severity));
    sorted.forEach(f => {
      const icon = SEV_ICONS[f.severity] || '⚪';
      md += `### ${icon} ${f.id} — ${f.title}\n\n`;
      md += `| | |\n|---|---|\n`;
      md += `| **Severity** | ${f.severity} |\n`;
      md += `| **Category** | ${f.category} |\n`;
      if (f.location?.line) md += `| **Line** | ~${f.location.line} |\n`;
      md += `\n${f.description}\n\n`;
      if (f.location?.code) md += `\`\`\`move\n${f.location.code}\n\`\`\`\n\n`;
      md += `**Impact:** ${f.impact}\n\n`;
      md += `> 💡 **Recommendation:** ${f.recommendation}\n\n---\n\n`;
    });
  } else {
    md += `## ✅ No Vulnerabilities Found\n\nThis contract appears safe based on AI analysis.\n\n`;
  }

  if (report.gasAnalysis) {
    md += `## ⚡ Gas Analysis\n- **Complexity:** ${report.gasAnalysis.complexity}\n- ${report.gasAnalysis.notes}\n\n`;
  }

  if (report.positives?.length) {
    md += `## ✅ Security Positives\n`;
    report.positives.forEach(p => { md += `- ${p}\n`; });
    md += '\n';
  }

  md += `---\n> ⚠️ ${report.disclaimer || 'AI-generated audit. Review by a human expert before production deployment.'}\n`;
  return md;
}

// ─── Terminal Report Printer ──────────────────────────────────────────────────
function printReport(report, filePath) {
  const riskColor = RISK_COLORS[report.riskLevel] || c.white;
  const order = ['CRITICAL','HIGH','MEDIUM','LOW','INFORMATIONAL'];
  const sorted = (report.findings || []).sort((a,b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  console.log('');
  console.log(sep('━'));
  console.log(`${c.bold}📊 AUDIT REPORT${c.reset} ${c.dim}—${c.reset} ${c.cyan}${report.contractName || 'Unknown'}${c.reset}`);
  console.log(sep('━'));
  console.log(`${c.dim}File       :${c.reset} ${filePath}`);
  console.log(`${c.dim}Risk Score :${c.reset} ${riskColor}${c.bold}${report.riskScore}/100  [${report.riskLevel}]${c.reset}`);
  console.log(`${c.dim}Findings   :${c.reset} ${c.bold}${(report.findings || []).length}${c.reset}`);
  console.log(`${c.dim}Lines      :${c.reset} ${report.lineCount || 'N/A'}   ${c.dim}Chars: ${(report.codeLength||0).toLocaleString()}`);
  console.log(`${c.dim}Model      :${c.reset} ${report.model || 'N/A'}`);
  console.log(sep('━'));

  console.log(`\n${c.dim}${report.summary || ''}${c.reset}\n`);

  if (sorted.length === 0) {
    console.log(`${c.green}${c.bold}✅ No vulnerabilities detected.${c.reset}`);
  } else {
    sorted.forEach((f, i) => {
      const sc = SEV_COLORS[f.severity] || c.white;
      const icon = SEV_ICONS[f.severity] || '⚪';
      if (i > 0) console.log(sep('·'));
      console.log(`\n${icon} ${sc}${c.bold}[${f.severity}]${c.reset} ${c.white}${c.bold}${f.id} — ${f.title}${c.reset}`);
      console.log(`   ${c.dim}Category  :${c.reset} ${f.category}${f.location?.line ? `   ${c.dim}Line ~${f.location.line}${c.reset}` : ''}`);
      console.log(`   ${c.dim}Desc      :${c.reset} ${f.description}`);
      if (f.location?.code) {
        const snippet = f.location.code.split('\n').slice(0, 3).join('\n             ');
        console.log(`   ${c.dim}Code      :${c.reset} ${c.gray}${snippet}${c.reset}`);
      }
      console.log(`   ${c.dim}Impact    :${c.reset} ${f.impact}`);
      console.log(`   ${c.green}💡 Fix    :${c.reset} ${f.recommendation}`);
    });
  }

  if (report.positives?.length) {
    console.log('\n' + sep('─'));
    console.log(`${c.green}${c.bold}✅ Security Positives${c.reset}`);
    report.positives.forEach(p => console.log(`  ${c.green}✓${c.reset} ${p}`));
  }

  if (report.gasAnalysis) {
    console.log('\n' + sep('─'));
    console.log(`${c.cyan}⚡ Gas Complexity:${c.reset} ${report.gasAnalysis.complexity}`);
    console.log(`   ${c.dim}${report.gasAnalysis.notes}${c.reset}`);
  }

  console.log('\n' + sep('━'));
  console.log(`${c.dim}⚠️  ${report.disclaimer || 'AI-generated. Review by human expert before production.'}${c.reset}`);
  console.log(sep('━') + '\n');
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function startSpinner(msg) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  process.stdout.write('\n');
  const id = setInterval(() => {
    process.stdout.write(`\r  ${c.cyan}${frames[i++ % frames.length]}${c.reset}  ${c.dim}${msg}${c.reset}   `);
  }, 80);
  return () => {
    clearInterval(id);
    process.stdout.write(`\r  ${c.green}✔${c.reset}  ${c.dim}${msg}${c.reset}   \n`);
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  // Header
  console.log(`\n${sep('━')}`);
  console.log(`${c.bold}${c.cyan}  🔒 Endless Auditor${c.reset} ${c.dim}— CLI${c.reset}`);
  console.log(sep('━'));

  if (args.help || !args.file) {
    showHelp();
    process.exit(0);
  }

  // Resolve file
  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`${c.red}✘ File not found: ${filePath}${c.reset}\n`);
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, 'utf-8').trim();
  if (code.length < 10) {
    console.error(`${c.red}✘ File is empty or too small.${c.reset}\n`);
    process.exit(1);
  }

  const MODEL = args.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error(`${c.red}✘ OPENROUTER_API_KEY not set. Add it to your .env file.${c.reset}\n`);
    process.exit(1);
  }

  console.log(`  ${c.dim}File  :${c.reset} ${filePath}`);
  console.log(`  ${c.dim}Model :${c.reset} ${MODEL}`);
  console.log(`  ${c.dim}Lines :${c.reset} ${code.split('\n').length}   ${c.dim}Chars: ${code.length.toLocaleString()}${c.reset}`);
  console.log(sep('─'));

  const stopSpinner = startSpinner('Sending contract to OpenRouter AI for analysis...');

  let report;
  try {
    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/endless/auditor',
        'X-Title': 'Endless Auditor CLI',
      },
    });

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 8192,
      messages: [{ role: 'user', content: buildAuditPrompt(code) }],
    });

    stopSpinner();

    const rawText = (completion.choices[0]?.message?.content || '').trim();
    let jsonText = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonText = jsonMatch[1].trim();

    report = JSON.parse(jsonText);
    report.auditedAt = new Date().toISOString();
    report.codeLength = code.length;
    report.lineCount = code.split('\n').length;
    report.model = MODEL;

  } catch (err) {
    stopSpinner();
    if (err instanceof SyntaxError) {
      console.error(`\n${c.red}✘ AI returned malformed JSON. Try again or use a different model.${c.reset}\n`);
    } else if (err.status === 401) {
      console.error(`\n${c.red}✘ Invalid API key. Check OPENROUTER_API_KEY in .env${c.reset}\n`);
    } else if (err.status === 429) {
      console.error(`\n${c.red}✘ Rate limit exceeded. Wait a moment and try again.${c.reset}\n`);
    } else {
      console.error(`\n${c.red}✘ Error: ${err.message}${c.reset}\n`);
    }
    process.exit(1);
  }

  // ─── Output ─────────────────────────────────────────────────────────────────
  if (args.output) {
    const ext = path.extname(args.output).toLowerCase();
    let content;
    if (ext === '.json' || args.format === 'json') {
      content = JSON.stringify(report, null, 2);
    } else {
      content = buildMarkdown(report, filePath);
    }
    fs.writeFileSync(args.output, content, 'utf-8');
    printReport(report, filePath);
    console.log(`${c.green}✔ Report saved to: ${args.output}${c.reset}\n`);
  } else if (args.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, filePath);
  }
}

main().catch(err => {
  console.error(`\n${c.red}Unexpected error: ${err.message}${c.reset}\n`);
  process.exit(1);
});
