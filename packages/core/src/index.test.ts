import { describe, expect, it } from 'vitest';
import { clamp } from './index';

describe('clamp', () => { it('clamps', () => expect(clamp(5, 0, 1)).toBe(1)); });
