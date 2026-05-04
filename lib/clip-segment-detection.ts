/**
 * clip-segment-detection.ts — Detect clip-worthy segments from STT word timestamps.
 *
 * Strategy: split on sentence boundaries at natural pause points, prefer segments
 * that are 30-60 seconds long (configurable). Score by completeness and length.
 */

export interface SttWord {
	text: string;
	start: number;
	end: number;
}

export interface DetectedSegment {
	start_sec: number;
	end_sec: number;
	text: string;
	score: number;
	word_count: number;
}

interface DetectionOptions {
	/** Minimum clip length in seconds. Default: 15 */
	minDurationSec?: number;
	/** Maximum clip length in seconds. Default: 60 */
	maxDurationSec?: number;
	/** Ideal clip length in seconds. Default: 40 */
	idealDurationSec?: number;
	/** Minimum pause (seconds) between words to consider a natural break. Default: 0.6 */
	pauseThresholdSec?: number;
	/** Maximum number of segments to return. Default: 50 */
	maxSegments?: number;
}

const SENTENCE_END = /[.!?]$/;

function isSentenceEnd(word: string): boolean {
	return SENTENCE_END.test(word.trim());
}

/**
 * Find natural break points (sentence endings followed by pauses).
 */
function findBreakPoints(words: SttWord[], pauseThreshold: number): number[] {
	const breaks: number[] = [0];

	for (let i = 0; i < words.length - 1; i++) {
		const gap = words[i + 1].start - words[i].end;
		const sentenceEnd = isSentenceEnd(words[i].text);

		if (sentenceEnd && gap >= pauseThreshold * 0.5) {
			breaks.push(i + 1);
		} else if (gap >= pauseThreshold) {
			breaks.push(i + 1);
		}
	}

	breaks.push(words.length);
	return [...new Set(breaks)].sort((a, b) => a - b);
}

/**
 * Score a candidate segment based on how close it is to ideal duration,
 * whether it starts/ends on sentence boundaries, and word density.
 */
function scoreSegment(
	words: SttWord[],
	startIdx: number,
	endIdx: number,
	idealDuration: number,
): number {
	if (endIdx <= startIdx) return 0;

	const duration = words[endIdx - 1].end - words[startIdx].start;
	if (duration <= 0) return 0;

	const durationDiff = Math.abs(duration - idealDuration);
	const durationScore = Math.max(0, 1 - durationDiff / idealDuration);

	const startsClean = startIdx === 0 || isSentenceEnd(words[startIdx - 1].text);
	const endsClean = endIdx === words.length || isSentenceEnd(words[endIdx - 1].text);
	const boundaryScore = (startsClean ? 0.2 : 0) + (endsClean ? 0.2 : 0);

	const wordCount = endIdx - startIdx;
	const wordsPerSec = wordCount / duration;
	const densityScore = Math.min(1, wordsPerSec / 3) * 0.2;

	return durationScore * 0.6 + boundaryScore + densityScore;
}

/**
 * Detect clip-worthy segments from STT word timestamps.
 */
export function detectSegments(
	words: SttWord[],
	options?: DetectionOptions,
): DetectedSegment[] {
	const minDur = options?.minDurationSec ?? 15;
	const maxDur = options?.maxDurationSec ?? 60;
	const idealDur = options?.idealDurationSec ?? 40;
	const pauseThreshold = options?.pauseThresholdSec ?? 0.6;
	const maxSegments = options?.maxSegments ?? 50;

	if (!words || words.length < 3) return [];

	const breaks = findBreakPoints(words, pauseThreshold);
	const candidates: DetectedSegment[] = [];

	for (let i = 0; i < breaks.length - 1; i++) {
		for (let j = i + 1; j < breaks.length; j++) {
			const startIdx = breaks[i];
			const endIdx = breaks[j];

			const duration = words[endIdx - 1].end - words[startIdx].start;

			if (duration < minDur) continue;
			if (duration > maxDur) break;

			const score = scoreSegment(words, startIdx, endIdx, idealDur);
			const segmentWords = words.slice(startIdx, endIdx);
			const text = segmentWords.map((w) => w.text).join(" ");

			candidates.push({
				start_sec: Math.max(0, words[startIdx].start - 0.1),
				end_sec: words[endIdx - 1].end + 0.1,
				text,
				score,
				word_count: segmentWords.length,
			});
		}
	}

	candidates.sort((a, b) => b.score - a.score);

	// De-duplicate overlapping segments (greedy: keep highest-scored first)
	const selected: DetectedSegment[] = [];
	for (const seg of candidates) {
		if (selected.length >= maxSegments) break;

		const overlaps = selected.some(
			(s) => seg.start_sec < s.end_sec && seg.end_sec > s.start_sec,
		);
		if (!overlaps) {
			selected.push(seg);
		}
	}

	selected.sort((a, b) => a.start_sec - b.start_sec);
	return selected;
}
