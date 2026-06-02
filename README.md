# 3Layer OCR — 3-Tier Fallback OCR with Google Sheets Integration

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2018-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Alok583/3layer-ocr/pulls)

**3Layer OCR** is an open-source, production-ready OCR pipeline that extracts text from images — including **blurry, distorted, or low-quality photos** — using a smart **4-tier fallback system** powered by Google Vision, OCR.space, Nemotron Vision LLM, and Tesseract.js. Extracted text is automatically synced to **Google Sheets** for easy data management.

Deploy it on your **local machine**, **VPS**, or a **Docker container** in minutes. All you need to bring are your API keys.

---

## 🧠 How the 3-Tier Fallback Works

```
📷 Image Uploaded
       │
       ▼
┌──────────────────────────────┐
│  Tier 1: Google Vision API   │  ← Best accuracy. Free: 1,000/month
│  (documentTextDetection)     │
└──────────────┬───────────────┘
               │ FAIL (quota, error, no credentials)
               ▼
┌──────────────────────────────┐
│  Tier 2: OCR.space API       │  ← Great fallback. Free: 25,000/month
│  (Engine 2)                  │
└──────────────┬───────────────┘
               │ FAIL (quota, error, no key)
               ▼
┌──────────────────────────────┐
│  Tier 3: Nemotron Vision LLM │  ← AI-powered. Free via OpenRouter.
│  (nvidia/nemotron via        │    Extracts structured JSON receipts.
│   OpenRouter)                │
└──────────────┬───────────────┘
               │ FAIL (no API key or error)
               ▼
┌──────────────────────────────┐
│  Tier 4: Tesseract.js Local  │  ← 100% free. No internet required.
│  + Sharp 10-stage blur fix   │    Blur recovery pipeline included.
└──────────────┬───────────────┘
               │
               ▼
        ✅ Text Extracted
               │
               ▼
   📊 Auto-saved to Google Sheets
```

This design guarantees text extraction even when APIs are down, rate-limited, or not configured.

---

## ✨ Features

- 🛡️ **4-Tier Fallback** — Google Vision → OCR.space → Nemotron Vision LLM → Tesseract.js. Never fails silently.
- 🤖 **Nemotron AI Vision (Tier 3)** — Nvidia's free Vision LLM via OpenRouter extracts perfectly structured JSON from receipts and documents when standard OCR fails.
- 📊 **Google Sheets Auto-Logging** — Saves `[Timestamp, ImageName, Text, Provider, Confidence]` per extraction.
- 🔌 **REST API Server** — Upload images via `POST /extract`. Easy to integrate with any frontend or workflow.
- 🖥️ **CLI Support** — Run OCR from the terminal without a server.
- 🐳 **Docker Ready** — One command to containerize and deploy anywhere.
- 🔓 **No Vendor Lock-in** — Works fully offline with Tesseract.js if APIs are not configured.
- 📂 **Batch Processing** — Extract from multiple images in one request.
- 🌐 **VPS Friendly** — Minimal resource footprint, designed for headless server environments.

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18
- (Optional) Google Cloud account for Vision API
- (Optional) OCR.space free API key

### 1. Clone and Install

```bash
git clone https://github.com/Alok583/3layer-ocr.git
cd 3layer-ocr
npm install
```

### 2. Configure API Keys

```bash
cp .env.example .env
```

Open `.env` and fill in your keys:

```env
# Path to your Google Service Account JSON file (enables Vision + Sheets)
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json

# OCR.space free API key → https://ocr.space/OCRAPI
OCR_SPACE_API_KEY=your_key_here

# OpenRouter API Key (for Nemotron Vision LLM Tier 3) → https://openrouter.ai
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Google Sheet ID from the URL of your spreadsheet
GOOGLE_SHEET_ID=your_sheet_id_here
```

> **No keys?** Just leave them blank. 3Layer OCR will still work using Tesseract.js locally.

### 3. Run the Server

```bash
npm run start
# Development mode (auto-reload):
npm run dev
```

The API is now live at `http://localhost:3000`.

---

## 📡 API Reference

### `POST /extract`
Upload a single image and get back extracted text.

**Request (multipart/form-data):**

| Field | Type   | Description                     |
|-------|--------|---------------------------------|
| image | File   | The image file to process       |
| lang  | string | Language code (default: `eng`)  |

**Response:**
```json
{
  "success": true,
  "filename": "receipt.jpg",
  "text": "Total: $42.50\nDate: 2024-01-15",
  "confidence": 100,
  "provider": "Google Vision API",
  "blurLevel": "blurry",
  "logs": [
    { "msg": "Attempting Tier 1: Google Vision API..." },
    { "msg": "Success with Google Vision API." }
  ]
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/extract \
  -F "image=@/path/to/blurry-photo.jpg"
```

### `POST /extract/batch`
Upload multiple images at once.

```bash
curl -X POST http://localhost:3000/extract/batch \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg"
```

### `POST /detect-blur`
Check the blur level of an image without running full OCR.

### `GET /health`
Returns server status and uptime.

---

## 💻 Programmatic Usage

Use 3Layer OCR as a Node.js library in your own projects:

```javascript
require('dotenv').config();
const { processImageFallback } = require('./src/index');

async function main() {
  const result = await processImageFallback('./invoice.png');

  console.log('Extracted Text:', result.text);
  console.log('Provider Used:', result.provider);
  console.log('Confidence:', result.confidence);
}

main();
```

---

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t 3layer-ocr .

# Run with your .env file
docker run -p 3000:3000 --env-file .env 3layer-ocr
```

Or using Docker Compose:
```bash
docker-compose up
```

---

## 🔑 How to Get Free API Keys

### Google Cloud Vision + Sheets API
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Enable **Cloud Vision API** and **Google Sheets API**
4. Go to **IAM & Admin → Service Accounts** → Create a service account
5. Download the JSON key file and save it as `google-credentials.json` in the project root
6. Share your Google Sheet with the service account email (as Editor)
> Free tier: **1,000 Vision API requests/month** — never expires.

### OCR.space API
1. Go to [ocr.space/OCRAPI](https://ocr.space/OCRAPI)
2. Register for a free API key (no credit card needed)
> Free tier: **25,000 requests/month**.

---

## 📊 Google Sheets Output

Every successful extraction appends a new row to your sheet:

| Timestamp | ImageName | ExtractedText | OCR_Provider_Used | Confidence |
|-----------|-----------|---------------|-------------------|------------|
| 2024-01-15T10:30:00Z | receipt.jpg | Total: $42.50 | Google Vision API | 100 |
| 2024-01-15T10:31:00Z | document.png | Invoice #1234 | OCR.space API | 80 |
| 2024-01-15T10:32:00Z | blurry.jpg | Name: John | Tesseract.js (Local) | 67.5 |

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a PR.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

## 🌟 If this helped you, please star the repo!

> Keywords: OCR, Blurry Image OCR, Free OCR API, Google Vision Node.js, Tesseract.js, Image to Text, Google Sheets API, Open Source OCR, Receipt OCR, Document OCR, 4-tier fallback, Vision LLM, Nemotron, OpenRouter, AI OCR, Structured JSON Extraction, Receipt Scanner
