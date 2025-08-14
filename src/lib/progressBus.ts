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

export type ProgressEvent =
    | { type: "stage"; stage: string }
    | { type: "manifest-resolved"; items: Layer[]|LockEntry[] }
    | { type: 'item-start'; index: number; digest: string; total?: number }
    | { type: 'item-progress'; index: number; received: number; total?: number }
    | { type: 'item-done'; index: number }
    | { type: 'tar-writing' }
    | { type: 'done'; filename: string }
    | { type: 'error'; message: string };

export class ProgressBus extends EventEmitter {
    emitEvent(e: ProgressEvent) { this.emit('progress', e); }
    onEvent(handler: (e: ProgressEvent) => void) { this.on('progress', handler) }
}

export const globalBusMap: Map<string, ProgressBus> = (global as any).__BUS_MAP__ || new Map();
if (!(global as any).__BUS_MAP__) (global as any).__BUS_MAP__ = globalBusMap;