'use strict';

/**
 * Legacy OCR module — no longer used.
 * All OCR is now handled via OpenRouter vision models in ocr-fallback.js
 * 
 * Kept for backward compatibility if anything imports from here.
 */

const { processImageFallback } = require('./ocr-fallback');

module.exports = {
  recognize: processImageFallback,
  getWorker: () => null,
  terminateAll: async () => {},
};
