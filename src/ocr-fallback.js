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
 * Tier 3: Nemotron Vision LLM via OpenRouter
 */
async function runNemotronVision(imagePath) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not defined in environment variables.');
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const payload = {
    model: 'nvidia/nemotron-nano-12b-v2-vl:free',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: "Analyze this image and extract all visible text into a JSON object. CRITICAL RULES: 1) Extract 'vehicle_number' (string) ONLY if explicitly labeled as Vehicle/Veh/Car. 2) Extract 'odometer_km' (integer) ONLY if labeled as ODO, KM, or ODOMETER. 3) Extract 'litres' (float) for the fuel volume. 4) Extract 'rate_per_litre' (float) for the price per litre. 5) Extract 'amount' (float) for the TOTAL FINAL AMOUNT PAID. Do NOT confuse Rate with Total Amount. 6) Extract 'fuel_date' (string, DD/MM/YYYY) and 'station_name' (string). 7) Extract 'raw_text' (string) with ALL readable text from the image. If any field is blank or missing, return null. DO NOT guess or borrow numbers from other fields."
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` }
          }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  };

  const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  const content = response.data.choices[0].message.content;
  if (!content) throw new Error('Nemotron Vision returned empty content.');

  // Return the raw_text field if present, otherwise the full JSON as text
  let text = content;
  try {
    const parsed = JSON.parse(content);
    text = parsed.raw_text || JSON.stringify(parsed, null, 2);
  } catch (_) { /* content is already plain text */ }

  return {
    text,
    confidence: 95,
    provider: 'Nemotron Vision LLM (OpenRouter)',
    structured: content // keep full JSON available
  };
}

/**
 * Tier 4: Tesseract.js (Local Fallback)
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
 * Orchestrator: 4-Tier Fallback System
 * 1. Google Vision API
 * 2. OCR.space API
 * 3. Nemotron Vision LLM (OpenRouter)
 * 4. Tesseract.js (Local)
 */
async function processImageFallback(imagePath, options = {}) {
  const logs = [];
  const log = (msg) => {
    console.log(`[OCR Pipeline] ${msg}`);
    logs.push({ ts: Date.now(), msg });
  };

  log('Starting 4-tier fallback OCR pipeline...');

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

  // 3. Nemotron Vision LLM
  try {
    log('Attempting Tier 3: Nemotron Vision LLM...');
    const result = await runNemotronVision(imagePath);
    log('Success with Nemotron Vision LLM.');
    return { ...result, logs };
  } catch (err) {
    log(`Tier 3 failed: ${err.message}`);
  }

  // 4. Tesseract.js
  try {
    log('Attempting Tier 4: Tesseract.js (Local)...');
    const result = await runTesseract(imagePath, options);
    log('Success with Tesseract.js.');
    return { ...result, logs };
  } catch (err) {
    log(`Tier 4 failed: ${err.message}`);
    throw new Error('All 4 OCR tiers failed to extract text from the image.');
  }
}

module.exports = {
  processImageFallback,
  runGoogleVision,
  runOcrSpace,
  runNemotronVision,
  runTesseract
};
