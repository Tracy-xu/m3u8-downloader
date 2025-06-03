import fs from 'fs';
import path from 'path';
import cliProgress from 'cli-progress';
/**
 * retry
 */
async function retry(fn, retries = 3, delay = 500) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        }
        catch (e) {
            if (i === retries) {
                throw e;
            }
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    throw new Error('Unexpected retry failure');
}
/**
 * limit promise concurrency
 */
async function runWithConcurrency(tasks, limit) {
    const running = new Set();
    for (const task of tasks) {
        const p = task();
        running.add(p);
        p.finally(() => running.delete(p));
        if (running.size >= limit) {
            await Promise.race(running);
        }
    }
    await Promise.all([...running]);
}
/**
 * clean folder
 */
function cleanup(folder) {
    fs.rmSync(folder, { recursive: true, force: true });
}
/**
 * psrse m3u8
 */
async function parseM3u8(m3u8Url) {
    const response = await fetch(m3u8Url);
    if (!response.ok) {
        throw new Error(`Failed to get m3u8: ${response.status}`);
    }
    const text = await response.text();
    const baseUrl = m3u8Url.split('/').slice(0, -1).join('/');
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => (line.startsWith('http') ? line : `${baseUrl}/${line}`));
}
/**
 * download single ts file
 */
async function downloadTs(url, index, folder, progressBar) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = path.join(folder, `${index.toString().padStart(5, '0')}.ts`);
    await fs.promises.writeFile(filename, buffer);
    progressBar.increment();
}
/**
 * merge ts file
 */
async function mergeTsFiles(folder, outputPath) {
    const files = (await fs.promises.readdir(folder))
        .filter((f) => f.endsWith('.ts'))
        .sort()
        .map((f) => path.join(folder, f));
    if (files.length === 0) {
        console.log('No TS files found to merge');
        return;
    }
    const outputDir = path.dirname(outputPath);
    await fs.promises.mkdir(outputDir, { recursive: true });
    const writeStream = fs.createWriteStream(outputPath);
    for (const file of files) {
        await new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(file);
            readStream.on('data', (chunk) => writeStream.write(chunk));
            readStream.on('end', resolve);
            readStream.on('error', reject);
        });
    }
    writeStream.end();
}
export default async function downloadM3u8(m3u8Url, maxConcurrency = 10, outputPath = `downloads/${Date.now()}.ts`) {
    const tsUrls = await parseM3u8(m3u8Url);
    const tempFolder = path.join('ts_temp', Date.now().toString());
    if (!fs.existsSync(tempFolder)) {
        fs.mkdirSync(tempFolder, { recursive: true });
    }
    const progressBar = new cliProgress.SingleBar({
        format: 'Progress | {bar} | {percentage}% | {value}/{total} 分片',
        hideCursor: true
    });
    progressBar.start(tsUrls.length, 0);
    const tasks = tsUrls.map((url, index) => async () => {
        try {
            await retry(() => downloadTs(url, index, tempFolder, progressBar));
        }
        catch (err) {
            if (err instanceof Error) {
                console.error(`❌ Download failed: ${url} - ${err.message}`);
            }
        }
    });
    await runWithConcurrency(tasks, maxConcurrency);
    progressBar.stop();
    console.log('🔗 Merge TS files......');
    await mergeTsFiles(tempFolder, outputPath);
    console.log(`✅ Video is saved as: ${outputPath}`);
    cleanup(tempFolder);
}
