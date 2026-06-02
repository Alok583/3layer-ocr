'use strict';

const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

let doc = null;
let initialized = false;

async function initSheets() {
  if (initialized) return;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!sheetId) {
    console.warn('GOOGLE_SHEET_ID not provided. Sheets integration disabled.');
    return;
  }

  if (!credsPath || !fs.existsSync(credsPath)) {
    console.warn('GOOGLE_APPLICATION_CREDENTIALS not found or invalid path. Sheets integration disabled.');
    return;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    const serviceAccountAuth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });

    doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();
    console.log(`[Google Sheets] Successfully loaded sheet: ${doc.title}`);
    initialized = true;
  } catch (err) {
    console.error(`[Google Sheets] Initialization failed: ${err.message}`);
  }
}

/**
 * Save OCR result to Google Sheets.
 * Structure: [Timestamp, ImageName, ExtractedText, OCR_Provider_Used, Confidence]
 */
async function saveToSheet(imageName, text, provider, confidence = '') {
  await initSheets();

  if (!doc) {
    return false; // Sheets integration not configured or failed
  }

  try {
    const sheet = doc.sheetsByIndex[0]; // use first sheet by default
    
    // Add header row if sheet is completely empty (optional, but good for UX)
    if (sheet.rowCount === 0) {
      await sheet.setHeaderRow(['Timestamp', 'ImageName', 'ExtractedText', 'OCR_Provider_Used', 'Confidence']);
    }

    await sheet.addRow({
      'Timestamp': new Date().toISOString(),
      'ImageName': imageName,
      'ExtractedText': text,
      'OCR_Provider_Used': provider,
      'Confidence': confidence
    });

    console.log(`[Google Sheets] Row added for image: ${imageName}`);
    return true;
  } catch (err) {
    console.error(`[Google Sheets] Failed to save row: ${err.message}`);
    return false;
  }
}

module.exports = {
  saveToSheet
};
