import { type LockEntry } from "../progressBus";

export function parseLockfile(lockText: string): LockEntry[] {
    const json = JSON.parse(lockText);
    const out: Map<string, LockEntry> = new Map();
    
    const push = (name?: string, version?: string, resolved?: string, integrity?: string) => {
        if (!name || !version) return;
        const key = `${name}@${version}`;
        if (!out.has(key)) out.set(key, { name, version, resolved, integrity });
    };
    
    if (json.packages && typeof json.packages === 'object') {
        for (const [pkgPath, info] of Object.entries<any>(json.packages)) {
            const nm = 'node_modules/';
            const i = pkgPath.lastIndexOf(nm);
            if (i === -1) continue;
            const seg = pkgPath.slice(i + nm.length);
            if (!seg) continue;
            const parts = seg.split('/');
            const name = seg.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
            const version = (info as any)?.version;
            const resolved = (info as any)?.resolved;
            const integrity = (info as any)?.integrity;
            push(name, version, resolved, integrity);
        }
    }
    
    // fallback for old shape
    function walk(name: string, node: any) {
        if (!node) return;
        if (node.version) push(name, node.version, node.resolved, node.integrity);
        const deps = node.dependencies || {};
        for (const [dn, dnode] of Object.entries<any>(deps)) walk(dn, dnode);
    }
    if (json.dependencies && typeof json.dependencies === 'object') {
        for (const [n, ninfo] of Object.entries<any>(json.dependencies)) walk(n, ninfo);
    }
    
    return Array.from(out.values());
}
