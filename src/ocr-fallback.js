'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── Configuration: 3-Layer Fallback via OpenRouter ───────────────────────────
const MODELS = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', supportsJsonFormat: true },
  { id: 'qwen/qwen-2.5-vl-72b-instruct', name: 'Qwen 2.5 VL 72B', supportsJsonFormat: true },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'Nemotron Nano 12B VL (Free)', supportsJsonFormat: false },
];

// The masterclass prompt — tailored specifically for Indian fuel receipts
const EXTRACTION_PROMPT = `You are an expert OCR data extractor for Indian fuel/petrol pump receipts.

Analyze this fuel receipt image and extract ONLY the following fields into a valid JSON object.

CRITICAL FIELD RULES:

1. "vehicle_number" (string): The vehicle registration number. Look for "Vehicle No", "VechNo", "Vehi.No", "VehNo", or a number like TG09U1976, TS10UB8409, or just 4-digit numbers like 4445, 6995. Return null if not found.

2. "driver_name" (string): The driver's name, usually at the top of the receipt or in WhatsApp message text. Return null if not found.

3. "fuel_type" (string): "Diesel", "Petrol", or "CNG". Look for "Product: DIESEL" or "Product: Petrol" or "EBMS" (which means Petrol). Return null if not found.

4. "litres" (float): The VOLUME of fuel in litres.
   - Look for "Volume(L)", "Volume(Ltr.)", "Vol(Ltr.)", "Vol in Ltrs", "Sale Volume".
   - CRITICAL: Values like "823.7 KG/m3", "830.6 Kg/cu.mtr", "828.1 kg/m3", "751.1Kg/Cu.mtr" are DENSITY, NOT volume! NEVER extract density as litres!
   - Typical volume range: 25 to 55 litres. If you see a number labeled as volume that is above 100, double-check — it might be density.
   - Strip leading zeros: "00050.03" → 50.03, "00036.71" → 36.71
   - Return null if not found.

5. "rate_per_litre" (float): The rate/price per litre.
   - Look for "Rate(Rs/L)", "Rate/Ltr.", "Rate", "Rate(₹/L)".
   - Typical range: 95 to 120 (Diesel ~103-104, Petrol ~115-116).
   - Return null if not found.

6. "amount" (float): The TOTAL FINAL AMOUNT PAID in Rupees.
   - Look for "Amount(Rs.)", "Amount(Rs)", "Fuel Amount", "TXN Amount", "Amount(R.)".
   - CRITICAL: This is ALWAYS the largest money value. Typical range: ₹2000 to ₹6000.
   - DO NOT confuse with Rate (which is ~103), Volume (which is ~30-50), or Density (which is ~820).
   - If there are multiple amounts (e.g. from multiple receipts in one image), extract the FIRST/PRIMARY one.
   - Strip leading zeros: "03811.23" → 3811.23, "05194.11" → 5194.11
   - NEVER extract dealer codes like "0000227917" or "0000179486" or "0000123357" as amounts! Those are dealer registration numbers in parentheses.
   - Return null if not found.

7. "odometer_km" (integer): The odometer/ODO reading in km.
   - Look for "ODO", "Odometer", "ODO 189155 km", or dashboard readings.
   - Typical range: 10000 to 500000.
   - Return null if not found.

8. "fuel_date" (string): The date in DD/MM/YYYY format.
   - Convert any format: "01-06-2026" → "01/06/2026", "31-May-2026" → "31/05/2026", "2 Jun 2026" → "02/06/2026".
   - Fix obvious typos: year "3026" should be "2026", "31/05/30" should be "31/05/2026".
   - Return null if not found.

9. "fuel_time" (string): The time of the transaction. Look for "Time:" field. Return as-is.

10. "station_name" (string): Name of the fuel station/pump. Return null if not found.

11. "raw_text" (string): ALL readable text from the image, concatenated.

EXAMPLES OF CORRECT EXTRACTION:

Receipt showing "Density: 823.7Kg/Cu.mtr, Rate: 103.82, Volume: 00036.71, Amount: 03811.23"
→ litres: 36.71, rate_per_litre: 103.82, amount: 3811.23 (density 823.7 is IGNORED)

Receipt showing "Rate(Rs/L): 103.82, Volume(L): 00050.03, Amount(Rs): 05194.11"
→ litres: 50.03, rate_per_litre: 103.82, amount: 5194.11

Receipt showing "DEALERS(0000227917)" 
→ This is a dealer code, NOT an amount! amount should come from "Amount(Rs.)" or "Fuel Amount" field.

Return ONLY the JSON object, no markdown, no explanation.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect all OpenRouter API keys from environment variables.
 * Supports: OPENROUTER_API_KEY, OPENROUTER_API_KEY_1, OPENROUTER_API_KEY_2, etc.
 */
function getApiKeys() {
  const keys = [];
  
  // Check for numbered keys first (OPENROUTER_API_KEY_1, _2, _3, ...)
  for (let i = 1; i <= 20; i++) {
    const key = process.env[`OPENROUTER_API_KEY_${i}`];
    if (key && key.trim()) keys.push(key.trim());
  }
  
  // If no numbered keys, check comma-separated single key
  if (keys.length === 0 && process.env.OPENROUTER_API_KEY) {
    const parts = process.env.OPENROUTER_API_KEY.split(',');
    for (const part of parts) {
      if (part.trim()) keys.push(part.trim());
    }
  }
  
  return keys;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Core: Call OpenRouter with a specific model ──────────────────────────────

async function callOpenRouter(imagePath, model, apiKeys) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const payload = {
    model: model.id,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
        ]
      }
    ],
    temperature: 0.1, // Low temperature for consistent, accurate extraction
    max_tokens: 2000,
  };

  // Add json_object format only for models that support it
  if (model.supportsJsonFormat) {
    payload.response_format = { type: 'json_object' };
  }

  let lastError;
  for (let i = 0; i < apiKeys.length; i++) {
    try {
      console.log(`[OCR] Trying ${model.name} with Key ${i + 1}/${apiKeys.length}...`);
      
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
        headers: {
          'Authorization': `Bearer ${apiKeys[i]}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://fuel-ocr.local',
          'X-Title': 'Fuel Receipt OCR'
        },
        timeout: 25000 // 25 second timeout for fast fallback
      });

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${model.name} returned empty content.`);

      return { content, model: model.name };

    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      
      if (status === 429) {
        console.log(`[OCR] Key ${i + 1} rate limited (429). Trying next key...`);
        continue; // Try next key
      }
      if (status === 401) {
        console.log(`[OCR] Key ${i + 1} unauthorized (401). Trying next key...`);
        continue; // Try next key — might be invalid
      }
      if (status === 402) {
        console.log(`[OCR] Key ${i + 1} out of credits (402). Trying next key...`);
        continue; // Try next key
      }
      if (status === 408 || status === 504 || status === 502 || status === 503) {
        console.log(`[OCR] Server error (${status}). Trying next key...`);
        continue; // Transient server error
      }
      
      // For other errors (400, 404, etc.), still try next key
      console.log(`[OCR] Key ${i + 1} failed with ${status || err.message}. Trying next key...`);
      continue;
    }
  }
  
  throw new Error(`All keys failed for ${model.name}. Last error: ${lastError?.response?.status || lastError?.message}`);
}

// ─── Parse AI response into structured data ───────────────────────────────────

function parseAIResponse(content) {
  // Try to extract JSON from the response
  let jsonStr = content.trim();
  
  // Remove markdown code fences if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (e) {
    // If JSON parsing fails, try to find JSON in the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (_) {}
    }
    // Return raw text as fallback
    return { raw_text: content };
  }
}

// ─── Main Pipeline: 3-Model Funnel ────────────────────────────────────────────

/**
 * Process an image through the 3-model funnel via OpenRouter:
 *   1. Gemini Flash 1.5 (fast + cheap)
 *   2. Qwen 2 VL 72B (strong vision fallback)
 *   3. Mistral Small 3.1 (final fallback)
 * 
 * If one model fails, the next one takes over.
 */
async function processImageFallback(imagePath, options = {}) {
  const logs = [];
  const log = (msg) => {
    console.log(`[OCR Pipeline] ${msg}`);
    logs.push({ ts: Date.now(), msg });
  };

  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    throw new Error('No OpenRouter API keys found! Set OPENROUTER_API_KEY_1 (or OPENROUTER_API_KEY) in your .env file.');
  }

  log(`Starting 3-model funnel (${apiKeys.length} API key(s) available)...`);

  for (const model of MODELS) {
    try {
      log(`Attempting: ${model.name}...`);
      const result = await callOpenRouter(imagePath, model, apiKeys);
      
      log(`✅ Success with ${result.model}!`);
      
      const parsed = parseAIResponse(result.content);
      const rawText = parsed.raw_text || result.content;

      return {
        text: rawText,
        confidence: 95,
        provider: result.model,
        structured: JSON.stringify(parsed),
        logs
      };

    } catch (err) {
      log(`❌ ${model.name} failed: ${err.message}`);
      // Continue to next model
    }
  }

  throw new Error('All 3 models (Nemotron, Gemini Flash, Qwen) failed to extract text from the image.');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  processImageFallback,
};
