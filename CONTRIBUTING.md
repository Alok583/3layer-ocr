# Contributing to 3Layer OCR

Thank you for your interest in contributing! 🎉

## How to Contribute

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/3layer-ocr.git`
3. **Create a branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes** and test them
5. **Commit**: `git commit -m "feat: add your feature"`
6. **Push**: `git push origin feature/your-feature-name`
7. **Open a Pull Request** against the `main` branch

## Development Setup

```bash
npm install
cp .env.example .env
# Fill in your API keys in .env
npm run dev
```

## Reporting Bugs

Open an issue at [github.com/Alok583/3layer-ocr/issues](https://github.com/Alok583/3layer-ocr/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS

## Code Style

- Use `'use strict'` at the top of every file
- Comment complex logic clearly
- Keep functions small and focused

## Ideas Welcome

- New OCR provider integrations
- Output format options (CSV, JSON, Markdown)
- UI dashboard for the REST API
