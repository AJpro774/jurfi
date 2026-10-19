/** A script failure captured for the editor. Play mode keeps running. */
export interface NodeFault {
  nodeId: string;
  message: string;
  error: unknown;
}

export const NODE_FAULT_CAP = 50;

export function faultMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
