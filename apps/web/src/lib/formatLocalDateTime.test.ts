import { describe, expect, it } from 'vitest';
import { formatLocalDateTime } from './formatLocalDateTime';

describe('formatLocalDateTime', () => {
    it('formats dates in German local order without swapping month and day', () => {
        expect(formatLocalDateTime('2026-07-11T12:08:51.000Z')).toContain('11.07.2026');
    });
});
