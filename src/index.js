'use strict';

require('dotenv').config();
const fs   = require('fs');
const { preprocessImage, savePreprocessed, detectBlurLevel } = require('./preprocessor');
const { recognize, terminateAll }                             = require('./ocr');
const { processImageFallback }                                = require('./ocr-fallback');

/**
 * Extract text from a single image using 3-tier fallback:
 * Google Vision → OCR.space → Tesseract.js (local)
 *
 * @param {string|Buffer} input   - File path or raw image buffer
 * @param {object}        options - Processing options
 * @returns {Promise<Result>}
 */
async function extract(input, options = {}) {
  const imagePath = Buffer.isBuffer(input)
    ? await _bufferToTempFile(input)
    : input;

  return processImageFallback(imagePath, options);
}

/**
 * Extract text from multiple images (batch mode).
 * Uses concurrency control to avoid memory exhaustion on VPS.
 *
 * @param {string[]|Buffer[]} inputs     - Array of file paths or buffers
 * @param {object}            options    - Options (same as extract)
 * @param {number}            concurrency - Max parallel jobs (default 2)
 * @returns {Promise<Result[]>}
 */
async function extractBatch(inputs, options = {}, concurrency = 2) {
  const results = [];
  const queue   = [...inputs];

  async function runJob(input) {
    try {
      const result = await extract(input, options);
      return { input: typeof input === 'string' ? input : '[buffer]', ...result, error: null };
    } catch (err) {
      return { input: typeof input === 'string' ? input : '[buffer]', error: err.message };
    }
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const batchResults = await Promise.all(batch.map(runJob));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Detect blur level of an image without running OCR.
 * @param {string|Buffer} input
 * @returns {Promise<'sharp'|'mild'|'blurry'|'veryBlur'>}
 */
async function detectBlur(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  return detectBlurLevel(buffer);
}

/**
 * Clean up Tesseract workers. Call on process exit.
 */
async function cleanup() {
  await terminateAll();
}

// Helper: write buffer to a temp file for API calls
const os = require('os');
const path = require('path');
async function _bufferToTempFile(buffer) {
  const tmpPath = path.join(os.tmpdir(), `3layer-ocr-${Date.now()}.png`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

process.on('SIGTERM', cleanup);
process.on('SIGINT',  cleanup);

module.exports = {
  extract,
  extractBatch,
  processImageFallback,
  detectBlur,
  cleanup,
  version: require('../package.json').version,
};
