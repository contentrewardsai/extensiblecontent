import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { statsForSingleAnswer, type VoteRow } from "@/lib/knowledge-votes";
import type { KnowledgeVoteSubmitBody, KnowledgeVoteValue } from "@/lib/types/knowledge";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

async function loadVotableAnswer(supabase: ReturnType<typeof getSupabase>, answerId: string) {
	const { data: answer, error: aErr } = await supabase
		.from("knowledge_answers")
		.select("id, question_id, status")
		.eq("id", answerId)
		.maybeSingle();

	if (aErr || !answer || answer.status !== "approved") {
		return null;
	}

	const { data: q, error: qErr } = await supabase
		.from("knowledge_questions")
		.select("status")
		.eq("id", answer.question_id as string)
		.maybeSingle();

	if (qErr || !q || q.status !== "approved") {
		return null;
	}

	return answer;
}

async function fetchVoteRowsForAnswer(supabase: ReturnType<typeof getSupabase>, answerId: string): Promise<VoteRow[]> {
	const { data, error } = await supabase
		.from("knowledge_answer_votes")
		.select("answer_id, vote, user_id")
		.eq("answer_id", answerId);

	if (error || !data) return [];

	return data.map((r) => ({
		answer_id: r.answer_id as string,
		vote: r.vote as KnowledgeVoteValue,
		user_id: r.user_id as string,
	}));
}

/**
 * POST: Set, flip, or clear vote on an approved answer (public Q&A only).
 * Body: { answer_id, direction: 'up' | 'down' | 'none' }
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: KnowledgeVoteSubmitBody;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (typeof body.answer_id !== "string" || !body.answer_id.trim()) {
		return Response.json({ error: "answer_id is required" }, { status: 400 });
	}

	const direction = body.direction;
	if (direction !== "up" && direction !== "down" && direction !== "none") {
		return Response.json({ error: "direction must be 'up', 'down', or 'none'" }, { status: 400 });
	}

	const answerId = body.answer_id.trim();
	const supabase = getSupabase();

	const answer = await loadVotableAnswer(supabase, answerId);
	if (!answer) {
		return Response.json({ error: "Answer not found" }, { status: 404 });
	}

	if (direction === "none") {
		const { error: delErr } = await supabase
			.from("knowledge_answer_votes")
			.delete()
			.eq("answer_id", answerId)
			.eq("user_id", user.user_id);

		if (delErr) {
			return Response.json({ error: delErr.message }, { status: 500 });
		}
	} else {
		const { error: upErr } = await supabase.from("knowledge_answer_votes").upsert(
			{
				answer_id: answerId,
				user_id: user.user_id,
				vote: direction,
			},
			{ onConflict: "answer_id,user_id" },
		);

		if (upErr) {
			return Response.json({ error: upErr.message }, { status: 500 });
		}
	}

	const rows = await fetchVoteRowsForAnswer(supabase, answerId);
	const { thumbs_up_count, thumbs_down_count, my_vote } = statsForSingleAnswer(rows, answerId, user.user_id);

	return Response.json({
		answer_id: answerId,
		direction,
		thumbs_up_count,
		thumbs_down_count,
		my_vote,
	});
}
