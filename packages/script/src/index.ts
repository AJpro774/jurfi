export interface ScriptContext { dt: number }
export type Script = (ctx: ScriptContext) => void;
export function runScripts(scripts: Script[], dt: number): void {
  for (const s of scripts) s({ dt });
}
