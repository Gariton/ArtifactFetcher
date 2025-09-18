import { EventEmitter } from "node:events";

export type Layer = {
    mediaType: string;
    digest: string;
    size: number;
}

export type LockEntry = {
    name: string;
    version: string;
    resolved?: string; // tarball URL
    integrity?: string;
};

export type FileInfo = {
    name: string;
    tmpPath: string;
}

export type RepoTag = {
    repository: string;
    tag: string;
}

export type ProgressEvent =
    | { type: "stage"; stage: string }
    | { type: "repo-tag-resolved"; items: RepoTag[]} // docker imageのrepoとtagを解決したときに送るやつ
    | { type: "manifest-resolved"; manifestName?: string; items: Layer[]|LockEntry[] }
    | { type: 'item-start'; index: number; scope?: string; manifestName?: string; digest: string; total?: number }
    | { type: 'item-progress'; index: number; scope?: string; manifestName?: string; received: number; total?: number }
    | { type: 'item-done'; scope?: string; manifestName?: string; index: number }
    | { type: 'item-skip'; scope?: string; manifestName?: string; index: number; reason: string;}
    | { type: 'item-error'; scope?: string; manifestName?: string; index: number; message: string }
    | { type: 'error-summary'; successes: Array<{ name: string; index: number }>; failures: Array<{ name: string; index: number; error: string }> }
    | { type: 'tar-writing' }
    | { type: 'done'; filename: string }
    | { type: 'error'; message: string };

export class ProgressBus extends EventEmitter {
    emitEvent(e: ProgressEvent) { this.emit('progress', e); }
    onEvent(handler: (e: ProgressEvent) => void) { this.on('progress', handler) }
}

export const globalBusMap: Map<string, ProgressBus> = (global as any).__BUS_MAP__ || new Map();
if (!(global as any).__BUS_MAP__) (global as any).__BUS_MAP__ = globalBusMap;
