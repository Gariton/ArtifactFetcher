import type { Writable } from 'node:stream';

/** Wait for writable backpressure while also reacting to abort/error closure. */
export function waitForDrain(stream: Writable): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            stream.removeListener('drain', onDrain);
            stream.removeListener('error', onError);
            stream.removeListener('close', onClose);
        };
        const onDrain = () => { cleanup(); resolve(); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const onClose = () => { cleanup(); reject(new Error('upload stream closed before draining')); };
        stream.once('drain', onDrain);
        stream.once('error', onError);
        stream.once('close', onClose);
    });
}
