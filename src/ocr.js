/**
 * BlurOCR — OCR Engine Wrapper
 * 
 * Wraps Tesseract.js with:
 *  - Worker pooling (reuse workers for batch jobs)
 *  - Configurable language + PSM mode
 *  - Per-word confidence extraction
 *  - hOCR structured output
 *  - Timing metrics
 */

'use strict';

const Tesseract = require('tesseract.js');

// ─── Worker pool cache (reuse workers for performance) ────────────────────────
const workerCache = new Map();

/**
 * Get or create a Tesseract worker for a given language.
 * Workers are cached and reused across calls.
 */
async function getWorker(lang = 'eng', onProgress = null) {
  const key = lang;
  if (workerCache.has(key)) return workerCache.get(key);

  const worker = await Tesseract.createWorker(lang, 1, {
    logger: m => {
      if (onProgress && m.status === 'recognizing text') {
        onProgress(m.progress);
      }
    },
  });

  workerCache.set(key, worker);
  return worker;
}

/**
 * Terminate all cached workers. Call on process exit.
 */
async function terminateAll() {
  for (const [key, worker] of workerCache.entries()) {
    await worker.terminate();
    workerCache.delete(key);
  }
}

/**
 * Main OCR function.
 * 
 * @param {Buffer}   imageBuffer  - Preprocessed image buffer (PNG recommended)
 * @param {object}   opts         - Options
 * @param {string}   opts.lang    - Tesseract language code(s), e.g. 'eng' or 'eng+fra'
 * @param {string}   opts.psm     - Page Segmentation Mode (1–13), default '6'
 * @param {function} opts.onProgress - Progress callback (0–1)
 * @returns {Promise<OCRResult>}
 */
async function recognize(imageBuffer, opts = {}) {
  const lang     = opts.lang       || 'eng';
  const psm      = opts.psm        || '6';
  const oem      = opts.oem        || '3';   // 3 = LSTM + legacy (best accuracy)
  const startTime = Date.now();

  const worker = await getWorker(lang, opts.onProgress);

  // Set OCR parameters
  await worker.setParameters({
    tessedit_pageseg_mode:  psm,
    tessedit_ocr_engine_mode: oem,
  });

  const result = await worker.recognize(imageBuffer);
  const data   = result.data;
  const elapsed = Date.now() - startTime;

  // Extract structured word data
  const words = (data.words || []).map(w => ({
    text:       w.text,
    confidence: Math.round(w.confidence * 10) / 10,
    bbox:       w.bbox,
  }));

  // Calculate weighted average confidence (by word length)
  const totalChars  = words.reduce((s, w) => s + w.text.length, 0);
  const weightedConf = totalChars > 0
    ? words.reduce((s, w) => s + w.confidence * w.text.length, 0) / totalChars
    : data.confidence;

  const text  = data.text.trim();
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  return {
    text,
    confidence:     Math.round(weightedConf * 10) / 10,
    words,
    lines,
    blocks:         (data.blocks  || []).map(b => ({ text: b.text, confidence: b.confidence })),
    paragraphs:     (data.paragraphs || []).map(p => ({ text: p.text, confidence: p.confidence })),
    hocr:           data.hocr || '',
    stats: {
      charCount:    text.replace(/\s/g, '').length,
      wordCount:    words.length,
      lineCount:    lines.length,
      ocrMs:        elapsed,
      lang,
      psm,
    },
  };
}

/**
 * @typedef {object} OCRResult
 * @property {string}   text           - Plain text output
 * @property {number}   confidence     - Overall confidence (0–100)
 * @property {Word[]}   words          - Per-word data with confidence + bounding box
 * @property {string[]} lines          - Text split by lines
 * @property {object[]} blocks         - Block-level data
 * @property {object[]} paragraphs     - Paragraph-level data
 * @property {string}   hocr           - hOCR XML output
 * @property {object}   stats          - Timing + character stats
 */

module.exports = { recognize, getWorker, terminateAll };
