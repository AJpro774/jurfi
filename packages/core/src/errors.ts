export type EcsErrorCode =
  | 'dead-entity'
  | 'unknown-component'
  | 'unknown-field'
  | 'invalid-value'
  | 'duplicate-component'
  | 'capacity'
  | 'invalid-entity'
  | 'invalid-scene'
  | 'cycle'
  | 'duplicate-alias'
  | 'duplicate-id'
  | 'disposed';

export class EcsError extends Error {
  readonly code: EcsErrorCode;

  constructor(code: EcsErrorCode, message: string) {
    super(message);
    this.name = 'EcsError';
    this.code = code;
  }
}
