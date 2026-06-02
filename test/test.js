'use strict';

require('dotenv').config();
const path = require('path');
const { processImageFallback } = require('../src/ocr-fallback');

async function runTest(label, imagePath) {
  console.log(`\n--- Test: ${label} ---`);
  try {
    const result = await processImageFallback(imagePath, { lang: 'eng' });
    console.log(`✅ Provider: ${result.provider}`);
    console.log(`   Confidence: ${result.confidence}`);
    console.log(`   Text: ${result.text.slice(0, 100)}...`);
  } catch (err) {
    console.error(`❌ Failed: ${err.message}`);
  }
}

async function main() {
  console.log('3Layer OCR — Test Suite');
  console.log('========================');
  
  // To test: replace with actual test image paths
  const sampleImage = process.argv[2];
  if (!sampleImage) {
    console.log('Usage: node test/test.js <path-to-image>');
    console.log('\nExample: node test/test.js ./examples/sample.jpg');
    return;
  }

  await runTest('3-Tier Fallback Pipeline', sampleImage);
}

main().catch(console.error);
