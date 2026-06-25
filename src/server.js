'use strict';

require('dotenv').config();

const express      = require('express');
const fileUpload   = require('express-fileupload');
const cors         = require('cors');
const morgan       = require('morgan');
const path         = require('path');
const fs           = require('fs');
const app3layer    = require('./index');
const { processImageFallback } = require('./ocr-fallback');
const { saveToSheet }          = require('./sheets');

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(fileUpload({
  limits:           { fileSize: 50 * 1024 * 1024 }, // 50MB max
  useTempFiles:     true,
  tempFileDir:      require('os').tmpdir(),
  abortOnLimit:     true,
  createParentPath: true,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ok(res, data, status = 200) {
  res.status(status).json({ success: true, ...data });
}
function fail(res, msg, status = 400) {
  res.status(status).json({ success: false, error: msg });
}

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  ok(res, {
    status:  'ok',
    uptime:  process.uptime(),
    memory:  process.memoryUsage(),
    version: app3layer.version,
  });
});

// ─── GET /version ─────────────────────────────────────────────────────────────
app.get('/version', (req, res) => {
  ok(res, {
    version:     app3layer.version,
    tiers:       ['Nemotron Nano 12B VL (Free)', 'Gemini 2.5 Flash', 'Qwen 2.5 VL 72B'],
    provider:    'OpenRouter',
    sheets:      !!process.env.GOOGLE_SHEET_ID,
    nodejs:      process.version,
  });
});

// ─── POST /extract ────────────────────────────────────────────────────────────
app.post('/extract', async (req, res) => {
  if (!req.files || !req.files.image) {
    return fail(res, 'No image file provided. Send image as multipart form field "image".');
  }

  const file = req.files.image;
  const opts = {
    lang: req.body.lang || 'eng',
    psm:  req.body.psm  || '6',
  };

  try {
    const imagePath = file.tempFilePath || file.data;
    const result    = await processImageFallback(imagePath, opts);

    // Save to Google Sheets (non-blocking, errors are logged not thrown)
    saveToSheet(file.name, result.text, result.provider, result.confidence).catch(console.error);

    // Clean up temp file
    if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
      fs.unlinkSync(file.tempFilePath);
    }

    ok(res, {
      filename:   file.name,
      text:       result.text,
      confidence: result.confidence,
      provider:   result.provider,
      blurLevel:  result.blurLevel || 'unknown',
      logs:       result.logs,
    });

  } catch (err) {
    console.error('[/extract] Error:', err);
    fail(res, err.message, 500);
  }
});

// ─── POST /extract/batch ──────────────────────────────────────────────────────
app.post('/extract/batch', async (req, res) => {
  if (!req.files) return fail(res, 'No files provided.');

  const files = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
  const opts  = { lang: req.body.lang || 'eng', psm: req.body.psm || '6' };

  try {
    const inputs = files.map(f => f.tempFilePath || f.data);
    const results = await app3layer.extractBatch(inputs, opts);

    const mapped = results.map((r, i) => {
      saveToSheet(files[i]?.name || `file_${i}`, r.text, r.provider, r.confidence).catch(console.error);
      return {
        filename:   files[i]?.name || `file_${i}`,
        text:       r.text,
        confidence: r.confidence,
        provider:   r.provider,
        blurLevel:  r.blurLevel || 'unknown',
        error:      r.error || null,
      };
    });

    files.forEach(f => {
      if (f.tempFilePath && fs.existsSync(f.tempFilePath)) fs.unlinkSync(f.tempFilePath);
    });

    ok(res, { count: mapped.length, results: mapped });

  } catch (err) {
    console.error('[/extract/batch] Error:', err);
    fail(res, err.message, 500);
  }
});

// ─── POST /detect-blur ────────────────────────────────────────────────────────
app.post('/detect-blur', async (req, res) => {
  if (!req.files || !req.files.image) return fail(res, 'No image file provided.');
  const file = req.files.image;

  try {
    const level = await app3layer.detectBlur(file.tempFilePath || file.data);

    if (file.tempFilePath && fs.existsSync(file.tempFilePath)) fs.unlinkSync(file.tempFilePath);

    ok(res, {
      filename:    file.name,
      blurLevel:   level,
      description: {
        sharp:    'Image is already clean — minimal processing needed',
        mild:     'Slight blur detected — moderate processing applied',
        blurry:   'Significant blur — aggressive processing applied',
        veryBlur: 'Severe blur — maximum processing applied',
      }[level] || 'Unknown',
    });

  } catch (err) {
    fail(res, err.message, 500);
  }
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => fail(res, `Route ${req.method} ${req.path} not found`, 404));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  fail(res, 'Internal server error', 500);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║          3Layer OCR  v${app3layer.version}                  ║
╠══════════════════════════════════════════════╣
║  Server  : http://${HOST}:${PORT}
║  Health  : http://${HOST}:${PORT}/health
║  Tiers   : Nemotron (Free) → Gemini 2.5 Flash → Qwen 2.5 VL (via OpenRouter)
║  Sheets  : ${process.env.GOOGLE_SHEET_ID ? '✅ Configured' : '⚠️  Not configured (set GOOGLE_SHEET_ID)'}
╚══════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM — shutting down gracefully…');
  server.close(async () => {
    await app3layer.cleanup();
    process.exit(0);
  });
});

module.exports = app;
