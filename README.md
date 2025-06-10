# M3U8-Downloader

A fast and easy to use m3u8 video download tool.

## Installation

```bash
npm install @telei/m3u8-downloader -g
# or
npx -p @telei/m3u8-downloader download-m3u8 "https://example.com/playlist.m3u8"
```

## Execution

```bash
download-m3u8 "https://example.com/playlist.m3u8"
```

## Help

```bash
PS D:\> download-m3u8 -h
Usage: download-m3u8 [options] <m3u8Url>

A fast and easy to use m3u8 video download tool.

Arguments:
  m3u8Url                     m3u8 url

Options:
  -V, --version               output the version number
  -c, --concurrency <number>  concurrency number (default: "10")
  -o, --output <path>         output path (default: "downloads/1748947029269.ts")
  -h, --help                  display help for command
```
