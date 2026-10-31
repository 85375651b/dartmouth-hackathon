import { spawn } from 'node:child_process';

export interface LiquidMember {
  item_id: string; qty: number; dims_cm: [number, number, number];
  shape: 'cylinder' | 'box'; upright_only?: boolean; height_axis?: 0 | 1 | 2;
}
export interface LiquidBundleResult {
  volume_cm3: number; bbox_cm: [number, number, number]; lower_bound_cm3: number;
  flexible: boolean; feasible: boolean;
  arrangement: { item_id: string; instance_index: number; position: number[]; size: number[]; orientation: number[] }[];
  warnings: string[];
}

/** Server-only in-memory bridge. The Python algorithm has no I/O. This adapter
 * transports JSON through pipes, never writes image, packing, or credential files.
 * Requires python3 (stdlib only), with a bounded child lifetime.
 */
export function packLiquids(members: LiquidMember[], options: { slack?: number; max_dims?: number[]; restarts?: number; seed?: number } = {}): Promise<LiquidBundleResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-B', '-c',
      'import json,sys; from dataclasses import asdict; from src.lib.packing.liquids import pack_liquids; print(json.dumps(asdict(pack_liquids(**json.load(sys.stdin)))))'],
    // Next bundles import.meta URLs as assets. The documented Next/CLI commands
    // run from the project root, so use that runtime directory for Python imports.
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Liquid packer subprocess exceeded its 2 second deadline.')); }, 2000);
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Liquid packer requires an available python3 runtime: ${error.message}`)); });
    child.stdout.on('data', data => { output += data; if (output.length > 2_000_000) { child.kill(); reject(new Error('Liquid packer output too large.')); } });
    child.stderr.on('data', data => { if (errors.length < 4000) errors += data; });
    child.stdin.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`Liquid packer failed: ${errors.trim()}`)); return; }
      try { resolve(JSON.parse(output) as LiquidBundleResult); } catch { reject(new Error('Invalid liquid packer response.')); }
    });
    child.stdin.end(JSON.stringify({ members, ...options }));
  });
}
