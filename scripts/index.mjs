#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usage, postJSON, sse, downloadToFile, ensureBar, updateBar } from './utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length < 3) { usage(); process.exit(1); }
const kind = args[0];                // docker | npm
const name = args[1];                // 例: library/redis | react
const tagOrVersion = args[2];        // 例: 7.2 | ^18
let host = 'http://localhost:3000';  // Next アプリのベースURL
let out = path.resolve(process.cwd(), 'downloads', kind, `${name.replaceAll('/', '_')}-${tagOrVersion}.tar`);
let platform = 'linux/amd64'

for (let i = 3; i < args.length; i++) {
    if (args[i] === '--host') host = args[++i];
    else if (args[i] === '--out') out = path.resolve(process.cwd(), 'downloads', kind, args[++i]);
    else if (args[i] === '--platform') platform = args[++i];
}

(async () => {
    if (kind === 'docker') {
        // 1) ジョブ開始
        const { jobId } = await postJSON(`${host}/api/docker/start`, {
            repo: name, tag: tagOrVersion, platform
        });
        console.log('jobId:', jobId);
        
        // 2) SSE で進捗購読（/api/build/progress）
        await new Promise((resolve, reject) => {
            const es = sse(`${host}/api/build/progress?jobId=${jobId}`, (e) => {
                if (e.type === 'stage') {
                    process.stdout.write(`\r[stage] ${e.stage}      `);
                }
                if (e.type === 'item-progress' && e.total) {
                    ensureBar(e.index, e.total || undefined, `layer ${e.index}`);
                    updateBar(e.index, e.received || 0, e.total || undefined);
                }
                if (e.type === 'error') {
                    es.close();
                    reject(new Error(e.message));
                }
                if (e.type === 'done')  {
                    es.close();
                    resolve();
                }
            });
        });
        
        // 3) 完了したら tar を取得
        const url = `${host}/api/build/download?jobId=${jobId}`;
        console.log('\nDownloading tar to', out);
        await downloadToFile(url, out);
        console.log('Saved:', out);
        
    } else if (kind === 'npm') {
        // npm は specs（name@semver）で lock をサーバ側生成 → 収集
        const spec = `${name}@${tagOrVersion}`;
        const { jobId } = await postJSON(`${host}/api/npm/start`, {
            specs: [spec],
            bundleName: `${name.replaceAll('/', '_')}-${tagOrVersion}`
        });
        console.log('jobId:', jobId);
        
        // 進捗購読（/api/npm/progress）
        await new Promise((resolve, reject) => {
            const es = sse(`${host}/api/build/progress?jobId=${jobId}`, (e) => {
                if (e.type === 'stage') process.stdout.write(`\r[stage] ${e.stage}      `);
                if (e.type === 'item-start') {
                    ensureBar(e.index, e.totalBytes || undefined, `item ${e.index}`);
                }
                if (e.type === 'item-progress' && e.totalBytes) {
                    ensureBar(e.index, e.totalBytes || undefined, `item ${e.index}`);
                    updateBar(e.index, e.received || 0, e.totalBytes || undefined);
                }
                if (e.type === 'error') { es.close(); reject(new Error(e.message)); }
                if (e.type === 'done')  { es.close(); resolve(); }
            });
        });
        
        // ダウンロード
        const url = `${host}/api/build/download?jobId=${jobId}`;
        console.log('\nDownloading tar to', out);
        await downloadToFile(url, out);
        console.log('Saved:', out);
        
    } else {
        usage();
        process.exit(1);
    }
})().catch(err => { console.error(err); process.exit(1); });