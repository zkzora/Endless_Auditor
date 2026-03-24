require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai').default;
const { buildAuditPrompt } = require('./prompts/audit-prompt');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// OpenRouter client (OpenAI-compatible)
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'Endless Auditor',
  },
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', model: MODEL });
});

// ─── Audit Endpoint ───────────────────────────────────────────────────────────
app.post('/api/audit', async (req, res) => {
  const { code } = req.body;

  if (!code || typeof code !== 'string' || code.trim().length < 10) {
    return res.status(400).json({
      error: 'Please provide a valid Move smart contract code.',
    });
  }

  if (code.length > 50000) {
    return res.status(400).json({
      error: 'Contract code is too large. Maximum 50,000 characters.',
    });
  }

  try {
    const prompt = buildAuditPrompt(code);

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 8192,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    const rawText = (completion.choices[0]?.message?.content || '').trim();

    // Strip markdown code fences if model wraps JSON in them
    let jsonText = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    let auditReport;
    try {
      auditReport = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      console.error('Raw AI response:', rawText.substring(0, 500));
      return res.status(500).json({
        error: 'AI returned malformed response. Please try again.',
        raw: rawText.substring(0, 300),
      });
    }

    // Enrich with metadata
    auditReport.auditedAt = new Date().toISOString();
    auditReport.codeLength = code.length;
    auditReport.lineCount = code.split('\n').length;
    auditReport.model = MODEL;

    return res.json(auditReport);
  } catch (err) {
    console.error('OpenRouter API error:', err.message);

    if (err.status === 401 || err.message?.includes('401')) {
      return res.status(401).json({ error: 'Invalid OpenRouter API key.' });
    }
    if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota')) {
      return res.status(429).json({ error: 'API rate limit exceeded. Please wait and try again.' });
    }

    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// ─── Serve frontend for all other routes (Locally only) ──────────────────────
if (!isVercel) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// ─── Start Server (Locally) / Export for Vercel ──────────────────────────────
if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`\n🔒 Endless Auditor`);
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`🤖 OpenRouter model: ${MODEL}`);
    console.log(`📋 API endpoint: POST http://localhost:${PORT}/api/audit\n`);
  });
}

module.exports = app;
