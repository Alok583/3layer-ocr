#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { Command } = require('commander');
const path        = require('path');
const chalk       = require('chalk');
const ora         = require('ora');
const { processImageFallback } = require('../src/ocr-fallback');
const pkg = require('../package.json');

const program = new Command();

program
  .name('3layer-ocr')
  .description('Extract text from images using a 3-tier fallback OCR pipeline')
  .version(pkg.version);

program
  .command('extract <imagePath>')
  .description('Extract text from an image')
  .option('-l, --lang <lang>', 'OCR language code', 'eng')
  .action(async (imagePath, opts) => {
    const spinner = ora('Running 3-tier OCR pipeline...').start();
    try {
      const result = await processImageFallback(path.resolve(imagePath), { lang: opts.lang });
      spinner.succeed(chalk.green(`Done! Provider used: ${result.provider}`));
      console.log('\n' + chalk.bold('Extracted Text:'));
      console.log('─'.repeat(50));
      console.log(result.text || chalk.gray('(no text found)'));
      console.log('─'.repeat(50));
      console.log(chalk.dim(`Confidence: ${result.confidence}% | Blur: ${result.blurLevel || 'n/a'}`));
    } catch (err) {
      spinner.fail(chalk.red('Extraction failed: ' + err.message));
      process.exit(1);
    }
  });

program.parse(process.argv);
