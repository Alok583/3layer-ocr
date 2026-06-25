'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { preprocessImage, detectBlurLevel } = require('./preprocessor');
const { processImageFallback }             = require('./ocr-fallback');

/**
 * Extract text from a single image using 3-layer OpenRouter fallback:
 * Gemini Flash → Qwen VL → Mistral
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
 * Cleanup (no-op since we don't use Tesseract workers anymore)
 */
async function cleanup() {
  // Nothing to clean up — OpenRouter is stateless
}

// Helper: write buffer to a temp file for API calls
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
