import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Arborist from '@npmcli/arborist';
import npa from 'npm-package-arg';
import { ProgressBus } from '../progressBus';

export async function makeLockFromSpecs(specs: string[], bus: ProgressBus, registry?: string) {
    bus.emitEvent({ type: 'stage', stage: 'arborist-init' });
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npmlock-'));
    const pkgJson = {
        name: 'tmp-project',
        version: '1.0.0',
        private: true,
        dependencies: Object.fromEntries(
            specs.map(s => { const p = npa(s); return [p.name!, p.rawSpec || 'latest']; })
        ),
    };
    await fs.promises.writeFile(path.join(work, 'package.json'), JSON.stringify(pkgJson, null, 2));
    
    const arb = new Arborist({ path: work, registry: registry || undefined });
    bus.emitEvent({ type: 'stage', stage: 'resolve-deps' });
    await arb.reify({ add: [], save: true });
    const lockText = await fs.promises.readFile(path.join(work, 'package-lock.json'), 'utf8');
    return { lockText, workDir: work };
}