/**
 * Session transcript — stub for source-mode compatibility.
 * Required by: src/services/compact/compact.ts (KAIROS flag)
 * Required by: src/utils/attachments.ts (KAIROS flag) — flushOnDateChange
 */

export async function writeSessionTranscriptSegment(_messages: unknown[]): Promise<void> {}

export async function flushOnDateChange(_messages: unknown[], _currentDate: string): Promise<void> {}
