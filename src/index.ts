#!/usr/bin/env node
import { program } from 'commander'
import downloadM3u8 from './download-m3u8.js'

program
  .name('download-m3u8')
  .version('1.0.0')
  .description('A fast and easy to use m3u8 video download tool.')
  .argument('<m3u8Url>', 'm3u8 url')
  .option('-c, --concurrency <number>', 'concurrency number', '10')
  .option('-o, --output <path>', 'output path', `downloads/${Date.now()}.ts`)
  .action(async (m3u8Url, options) => {
    try {
      await downloadM3u8(m3u8Url, Number(options.concurrency), options.output)
    } catch (err) {
      if (err instanceof Error) {
        console.error(`❌ Download failed: ${err.message}`)
      }
      process.exit(1)
    }
  })

program.parse(process.argv)
