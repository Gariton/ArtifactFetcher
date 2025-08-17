import fs from 'node:fs';
import { EventSource } from 'eventsource';
import ProgressBar from "progress";

export function usage() {
    console.log('Usage:');
    console.log('  npm run download -- <docker|npm> <name> <tag|semver> [--host https://example.com] [--out ./output.tar]');
    console.log('  pnpm download <docker|npm> <name> <tag|semver> [--host https://example.com] [--out ./output.tar]');
    console.log('  yarn download <docker|npm> <name> <tag|semver> [--host https://example.com] [--out ./output.tar]');
    console.log('\nTIP: npm は run-script の引数を `--` の後ろに付けないと渡されません。');
}

export async function postJSON(url, body) {
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`POST ${url} failed: ${r.status}`);
    return r.json();
}

export function sse(url, onEvent) {
    const es = new EventSource(url);
    es.onmessage = (ev) => onEvent(JSON.parse(ev.data));
    es.onerror = () => {}; // 接続クローズ時などのエラーは握りつぶす
    return es;
}

export async function downloadToFile(url, dest) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
    const file = fs.createWriteStream(dest);
    const reader = r.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        file.write(Buffer.from(value));
    }
    await new Promise((res, rej) => file.end(err => err ? rej(err) : res()));
}

export const bars = new Map();
export const lastBytes = new Map();

export function ensureBar (key, total, label) {
    if (!bars.has(key)) {
        const t = total || 0;
        const bar = new ProgressBar(`${label} [:bar] :percent :rate/bps :etas`, {
            total: t > 0 ? t : 100,
            width: 24,
            clear: false 
        });
        bars.set(key, bar);
        lastBytes.set(key, 0);
    }
    return bars.get(key);
}

export function updateBar (key, received, maybeTotal) {
    const bar = bars.get(key);
    if (!bar) return;
    const prev = lastBytes.get(key) || 0;
    const delta = Math.max(0, received - prev);
    lastBytes.set(key, received);
    if (maybeTotal && bar.total !== maybeTotal) bar.total = maybeTotal;
    const remaining = Math.max(0, bar.total - bar.curr);
    bar.tick(Math.min(delta, remaining));
}