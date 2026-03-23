import type { KnowledgeVoteValue } from "@/lib/types/knowledge";

export interface VoteRow {
	answer_id: string;
	vote: KnowledgeVoteValue;
	user_id: string;
}

/** Aggregate vote rows into per-answer counts and the caller’s vote (at most one row per user per answer). */
export function voteAggregatesByAnswerId(
	rows: VoteRow[],
	callerUserId: string,
): Map<string, { thumbs_up_count: number; thumbs_down_count: number; my_vote: KnowledgeVoteValue | null }> {
	const acc = new Map<string, { up: number; down: number; my: KnowledgeVoteValue | null }>();
	for (const r of rows) {
		let e = acc.get(r.answer_id);
		if (!e) {
			e = { up: 0, down: 0, my: null };
			acc.set(r.answer_id, e);
		}
		if (r.vote === "up") e.up += 1;
		else e.down += 1;
		if (r.user_id === callerUserId) e.my = r.vote;
	}
	const out = new Map<string, { thumbs_up_count: number; thumbs_down_count: number; my_vote: KnowledgeVoteValue | null }>();
	for (const [id, e] of acc) {
		out.set(id, { thumbs_up_count: e.up, thumbs_down_count: e.down, my_vote: e.my });
	}
	return out;
}

export function statsForSingleAnswer(
	rows: VoteRow[],
	answerId: string,
	callerUserId: string,
): { thumbs_up_count: number; thumbs_down_count: number; my_vote: KnowledgeVoteValue | null } {
	const m = voteAggregatesByAnswerId(rows, callerUserId);
	return (
		m.get(answerId) ?? {
			thumbs_up_count: 0,
			thumbs_down_count: 0,
			my_vote: null,
		}
	);
}
