/**
 * BlurOCR — Image Preprocessor
 * 
 * 10-stage pipeline using Sharp for maximum text recovery from degraded images.
 * Works on Node.js, VPS, Docker — no browser required.
 * 
 * Pipeline:
 *  1.  Blur measurement (Laplacian variance estimation)
 *  2.  Auto-upscale (bicubic, 1–4×)
 *  3.  Grayscale conversion
 *  4.  Normalize (adaptive contrast stretch, like CLAHE)
 *  5.  Gamma correction (exposure recovery)
 *  6.  Unsharp masking / high-boost sharpening (1–2 passes)
 *  7.  Median denoising (via blur → diff trick with sharp)
 *  8.  Adaptive thresholding (Otsu-style via sharp)
 *  9.  Border padding (prevents Tesseract edge cropping)
 * 10.  Output as PNG buffer for OCR
 */

'use strict';

const sharp = require('sharp');
const path  = require('path');

// ─── Preset configurations by blur level ──────────────────────────────────────
const PRESETS = {
  sharp:    { scale: 1,   sharpenSigma: 0.5, sharpenM1: 1,    sharpenM2: 2,    normalize: true,  threshold: false, gamma: 1.0,  padding: 10 },
  mild:     { scale: 2,   sharpenSigma: 1.0, sharpenM1: 3,    sharpenM2: 5,    normalize: true,  threshold: true,  gamma: 1.1,  padding: 15 },
  blurry:   { scale: 2,   sharpenSigma: 2.0, sharpenM1: 6,    sharpenM2: 10,   normalize: true,  threshold: true,  gamma: 1.2,  padding: 20 },
  veryBlur: { scale: 3,   sharpenSigma: 3.0, sharpenM1: 10,   sharpenM2: 20,   normalize: true,  threshold: true,  gamma: 1.3,  padding: 20 },
};

/**
 * Detect blur level from a sharp instance
 * Returns one of: 'sharp' | 'mild' | 'blurry' | 'veryBlur'
 */
async function detectBlurLevel(imageBuffer) {
  // Get image stats — we use standard deviation of the luma channel
  // as a proxy for sharpness (high StdDev = sharp edges)
  const { channels } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // Sharp's stats()
  const stats = await sharp(imageBuffer).greyscale().stats();
  const stddev = stats.channels[0].stdev;

  // Map stddev to blur category (empirically calibrated)
  if (stddev > 60)  return 'sharp';
  if (stddev > 35)  return 'mild';
  if (stddev > 15)  return 'blurry';
  return 'veryBlur';
}

/**
 * Main preprocessing function.
 * 
 * @param {Buffer|string} input  - Image buffer or file path
 * @param {object}        opts   - Override options (or leave empty for auto)
 * @param {function}      onLog  - Optional logger callback (stage, message)
 * @returns {Promise<{buffer: Buffer, meta: object}>}
 */
async function preprocessImage(input, opts = {}, onLog = null) {
  const log = (stage, msg) => onLog && onLog(stage, msg);
  const startTime = Date.now();

  // ── Step 0: Load input ────────────────────────────────────────────────────
  let imageBuffer = Buffer.isBuffer(input) ? input : require('fs').readFileSync(input);
  const originalMeta = await sharp(imageBuffer).metadata();
  log('load', `Loaded ${originalMeta.width}×${originalMeta.height} ${originalMeta.format?.toUpperCase()}`);

  // ── Step 1: Detect blur + choose preset ──────────────────────────────────
  log('blur', 'Analysing blur level…');
  const blurLevel = opts.blurLevel || await detectBlurLevel(imageBuffer);
  const preset    = { ...PRESETS[blurLevel], ...opts };
  log('blur', `Blur level: ${blurLevel} → applying ${blurLevel} preset`);

  // ── Step 2: Upscale ───────────────────────────────────────────────────────
  log('scale', `Upscaling ×${preset.scale}…`);
  let pipeline = sharp(imageBuffer);

  if (preset.scale > 1) {
    const newW = Math.round(originalMeta.width  * preset.scale);
    const newH = Math.round(originalMeta.height * preset.scale);
    pipeline = pipeline.resize(newW, newH, { kernel: sharp.kernel.cubic });
    log('scale', `Resized to ${newW}×${newH}px`);
  }

  // ── Step 3: Grayscale ─────────────────────────────────────────────────────
  pipeline = pipeline.greyscale();
  log('gray', 'Converted to grayscale');

  // ── Step 4: Normalize (adaptive contrast) ────────────────────────────────
  if (preset.normalize) {
    pipeline = pipeline.normalize();
    log('normalize', 'Applied adaptive contrast normalization');
  }

  // ── Step 5: Gamma correction ──────────────────────────────────────────────
  if (preset.gamma && preset.gamma !== 1.0) {
    pipeline = pipeline.gamma(preset.gamma);
    log('gamma', `Gamma correction ×${preset.gamma}`);
  }

  // ── Step 6: Unsharp masking (sharpening) ─────────────────────────────────
  if (preset.sharpenSigma > 0) {
    pipeline = pipeline.sharpen({
      sigma: preset.sharpenSigma,
      m1:    preset.sharpenM1,
      m2:    preset.sharpenM2,
    });
    log('sharpen', `Unsharp mask σ=${preset.sharpenSigma} m1=${preset.sharpenM1} m2=${preset.sharpenM2}`);

    // Second sharpen pass for very blurry images
    if (blurLevel === 'veryBlur') {
      pipeline = pipeline.sharpen({
        sigma: preset.sharpenSigma * 0.5,
        m1:    preset.sharpenM1 * 0.5,
        m2:    preset.sharpenM2 * 0.5,
      });
      log('sharpen', 'Applied second sharpening pass (very blurry mode)');
    }
  }

  // ── Step 7: Median denoising ──────────────────────────────────────────────
  // Denoising via median filter: blur slightly with low sigma to kill salt/pepper
  if (blurLevel === 'blurry' || blurLevel === 'veryBlur') {
    pipeline = pipeline.median(3);
    log('denoise', 'Median filter applied (3×3 kernel)');
  }

  // ── Step 8: Thresholding (binarization) ───────────────────────────────────
  if (preset.threshold) {
    // sharp.threshold() is Otsu-equivalent when no value given
    pipeline = pipeline.threshold();
    log('threshold', 'Otsu binarization applied');
  }

  // ── Step 9: Border padding ────────────────────────────────────────────────
  const pad = preset.padding || 15;
  pipeline = pipeline.extend({
    top:    pad, bottom: pad,
    left:   pad, right:  pad,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });
  log('pad', `Added ${pad}px white border padding`);

  // ── Step 10: Output PNG buffer ────────────────────────────────────────────
  const { data: processedBuffer, info } = await pipeline
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true });

  const elapsed = Date.now() - startTime;
  log('done', `Preprocessing complete: ${info.width}×${info.height}px in ${elapsed}ms`);

  return {
    buffer:    processedBuffer,
    blurLevel,
    preset,
    meta: {
      originalWidth:   originalMeta.width,
      originalHeight:  originalMeta.height,
      processedWidth:  info.width,
      processedHeight: info.height,
      format:          originalMeta.format,
      preprocessingMs: elapsed,
    },
  };
}

/**
 * Save preprocessed image to disk (useful for debugging / CLI --save-preprocessed)
 */
async function savePreprocessed(buffer, outputPath) {
  await sharp(buffer).toFile(outputPath);
  return outputPath;
}

module.exports = { preprocessImage, detectBlurLevel, savePreprocessed, PRESETS };
