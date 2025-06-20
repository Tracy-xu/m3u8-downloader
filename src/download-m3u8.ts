import fs from 'fs'
import path from 'path'
import cliProgress from 'cli-progress'
import inquirer from 'inquirer'

/**
 * retry
 */
async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 500): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === retries) {
        throw e
      }
      await new Promise((res) => setTimeout(res, delay))
    }
  }
  throw new Error('Unexpected retry failure')
}

/**
 * limit promise concurrency 
 */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
  const running = new Set<Promise<T>>()

  for (const task of tasks) {
    const p = task()
    running.add(p)
    p.finally(() => running.delete(p))
    if (running.size >= limit) {
      await Promise.race(running)
    }
  }

  await Promise.all([...running])
}

/**
 * clean folder
 */
function cleanup(folder: string): void {
  fs.rmSync(folder, { recursive: true, force: true })
}

/**
 * psrse m3u8
 */
async function parseM3u8(m3u8Url: string): Promise<string[]> {
  const res = await fetch(m3u8Url)
  if (!res.ok) {
    throw new Error(`Failed to get m3u8: ${res.status}`)
  }
  const text = await res.text()
  const baseUrl = m3u8Url.split('/').slice(0, -1).join('/')
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => (line.startsWith('http') ? line : `${baseUrl}/${line}`))
}

/**
 * download single ts file
 */
async function downloadTs(
  url: string,
  index: number,
  folder: string,
  progressBar: cliProgress.SingleBar
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const filename = path.join(folder, `${index.toString().padStart(5, '0')}.ts`)
  await fs.promises.writeFile(filename, buffer)
  progressBar.increment()
}

/**
 * merge ts file
 */
async function mergeTsFiles(folder: string, outputPath: string): Promise<void> {
  const files = (await fs.promises.readdir(folder))
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => path.join(folder, f))

  if (files.length === 0) {
    console.log('No TS files found to merge')
    return
  }

  const outputDir = path.dirname(outputPath)
  await fs.promises.mkdir(outputDir, { recursive: true })

  const writeStream = fs.createWriteStream(outputPath)
  for (const file of files) {
    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(file)
      readStream.on('data', (chunk) => writeStream.write(chunk))
      readStream.on('end', resolve)
      readStream.on('error', reject)
    })
  }
  writeStream.end()
}

/**
 * determines whether an m3u8 URL is a master playlist
 */
async function isMasterPlaylist(url: string): Promise<boolean> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch m3u8: ${res.status}`)
  }
  const text = await res.text()
  return text.includes('#EXT-X-STREAM-INF')
}

/**
 * select m3u8 URL
 */
async function chooseM3u8(masterUrl: string): Promise<string> {
  const res = await fetch(masterUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch m3u8: ${res.status}`)
  }
  const text = await res.text()
  const baseUrl = masterUrl.split('/').slice(0, -1).join('/')

  const lines = text.split('\n').map(line => line.trim())
  const streamInfos: {
    name?: string
    resolution?: string
    bandwidth?: string
    url: string
  }[] = []

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      const bandwidth = /BANDWIDTH=(\d+)/.exec(lines[i])?.[1]
      const resolution = /RESOLUTION=([0-9x]+)/.exec(lines[i])?.[1]
      const name = /NAME="([^"]+)"/.exec(lines[i])?.[1]
      const url = lines[i + 1]?.startsWith('http')
        ? lines[i + 1]
        : `${baseUrl}/${lines[i + 1]}`
      streamInfos.push({ name, resolution, bandwidth, url })
    }
  }

  if (streamInfos.length === 0) {
    throw new Error('No media streams found in master playlist')
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: 'Please select clarity：',
      choices: streamInfos.map((info, index) => ({
        name: `name: ${info.name}, resolution: ${info.resolution}, BANDWIDTH: ${info.bandwidth} bps`,
        value: index
      }))
    }
  ])

  return streamInfos[selected].url
}

export default async function downloadM3u8(
  m3u8Url: string,
  maxConcurrency: number = 10,
  outputPath: string = `downloads/${Date.now()}.ts`
): Promise<void> {
  if (await isMasterPlaylist(m3u8Url)) {
    m3u8Url = await chooseM3u8(m3u8Url)
  }

  const tsUrls = await parseM3u8(m3u8Url)

  const tempFolder = path.join('ts_temp', Date.now().toString())
  if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder, { recursive: true })
  }

  const progressBar = new cliProgress.SingleBar({
    format: 'Progress | {bar} | {percentage}% | {value}/{total} chunks',
    hideCursor: true
  })
  progressBar.start(tsUrls.length, 0)

  const tasks: (() => Promise<void>)[] = tsUrls.map((url, index) => async () => {
    try {
      await retry(() => downloadTs(url, index, tempFolder, progressBar))
    } catch (err) {
      if (err instanceof Error) {
        console.error(`❌ Download failed: ${url} - ${err.message}`)
      }
    }
  })

  await runWithConcurrency(tasks, maxConcurrency)

  progressBar.stop()
  console.log('🔗 Merge TS files......')
  await mergeTsFiles(tempFolder, outputPath)
  console.log(`✅ Video is saved as: ${outputPath}`)
  cleanup(tempFolder)
}
