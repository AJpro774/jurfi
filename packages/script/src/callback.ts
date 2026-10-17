/** Code-authored callback scripts. Visual graphs use `createScriptRuntime` instead. */
export interface ScriptContext {
  dt: number;
}

export type Script = (ctx: ScriptContext) => void;

export function runScripts(scripts: Script[], dt: number): void {
  for (const script of scripts) script({ dt });
}
