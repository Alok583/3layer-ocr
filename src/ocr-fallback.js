'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const vision = require('@google-cloud/vision');

// Delay loading blurocr to prevent circular dependencies if needed
let blurocrExtract = null;

// Initialize Google Vision client only if credentials are provided
let visionClient = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    visionClient = new vision.ImageAnnotatorClient();
  } catch (err) {
    console.warn('Google Vision client initialization failed. Credentials might be invalid.');
  }
}

/**
 * Tier 1: Google Cloud Vision API
 */
async function runGoogleVision(imagePath) {
  if (!visionClient) {
    throw new Error('Google Vision client not initialized. Missing GOOGLE_APPLICATION_CREDENTIALS.');
  }
  
  const [result] = await visionClient.documentTextDetection(imagePath);
  const fullTextAnnotation = result.fullTextAnnotation;
  
  if (!fullTextAnnotation || !fullTextAnnotation.text) {
    throw new Error('Google Vision API returned no text.');
  }
  
  return {
    text: fullTextAnnotation.text,
    confidence: 100, // Google Vision doesn't provide a single global confidence score easily
    provider: 'Google Vision API'
  };
}

/**
 * Tier 2: OCR.space API
 */
async function runOcrSpace(imagePath) {
  if (!process.env.OCR_SPACE_API_KEY) {
    throw new Error('OCR_SPACE_API_KEY is not defined in environment variables.');
  }

  const formData = new FormData();
  formData.append('file', fs.createReadStream(imagePath));
  formData.append('apikey', process.env.OCR_SPACE_API_KEY);
  formData.append('OCREngine', '2'); // Engine 2 is better for special chars / blur
  
  const response = await axios.post('https://api.ocr.space/parse/image', formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  const data = response.data;
  
  if (data.IsErroredOnProcessing || !data.ParsedResults || data.ParsedResults.length === 0) {
    throw new Error(`OCR.space API error: ${data.ErrorMessage || 'No text found'}`);
  }

  const text = data.ParsedResults.map(pr => pr.ParsedText).join('\n').trim();
  
  if (!text) {
    throw new Error('OCR.space returned empty text.');
  }

  return {
    text,
    confidence: 80, // Approximate confidence for fallback
    provider: 'OCR.space API'
  };
}

/**
 * Tier 3: Tesseract.js (Local Fallback)
 */
async function runTesseract(imagePath, options = {}) {
  if (!blurocrExtract) {
    // Lazy load to prevent circular dependencies
    blurocrExtract = require('./index').extract;
  }
  const result = await blurocrExtract(imagePath, options);
  if (!result || !result.text) {
    throw new Error('Tesseract (Local) returned no text.');
  }
  return {
    text: result.text,
    confidence: result.confidence,
    provider: 'Tesseract.js (Local)',
    blurLevel: result.blurLevel
  };
}

/**
 * Orchestrator: 3-Tier Fallback System
 * 1. Google Vision API
 * 2. OCR.space API
 * 3. Tesseract.js (Local)
 */
async function processImageFallback(imagePath, options = {}) {
  const logs = [];
  const log = (msg) => {
    console.log(`[OCR Pipeline] ${msg}`);
    logs.push({ ts: Date.now(), msg });
  };

  log('Starting 3-tier fallback OCR pipeline...');

  // 1. Google Vision
  try {
    log('Attempting Tier 1: Google Vision API...');
    const result = await runGoogleVision(imagePath);
    log('Success with Google Vision API.');
    return { ...result, logs };
  } catch (err) {
    log(`Tier 1 failed: ${err.message}`);
  }

  // 2. OCR.space
  try {
    log('Attempting Tier 2: OCR.space API...');
    const result = await runOcrSpace(imagePath);
    log('Success with OCR.space API.');
    return { ...result, logs };
  } catch (err) {
    log(`Tier 2 failed: ${err.message}`);
  }

  // 3. Tesseract.js
  try {
    log('Attempting Tier 3: Tesseract.js (Local)...');
    const result = await runTesseract(imagePath, options);
    log('Success with Tesseract.js.');
    return { ...result, logs };
  } catch (err) {
    log(`Tier 3 failed: ${err.message}`);
    throw new Error('All OCR tiers failed to extract text from the image.');
  }
}

module.exports = {
  processImageFallback,
  runGoogleVision,
  runOcrSpace,
  runTesseract
};
