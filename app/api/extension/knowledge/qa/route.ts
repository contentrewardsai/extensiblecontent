import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { siteDomainFromSearchParams } from "@/lib/knowledge-domain";
import { voteAggregatesByAnswerId, type VoteRow } from "@/lib/knowledge-votes";
import type { KnowledgeQAPair, KnowledgeVoteValue } from "@/lib/types/knowledge";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: Approved Q&A pairs for a site domain (for sidepanel / local ranking).
 * Query: exactly one of origin, hostname, or domain.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const parsed = siteDomainFromSearchParams(request.nextUrl.searchParams);
	if (!parsed.ok) {
		return Response.json({ error: parsed.error }, { status: 400 });
	}
	const siteDomain = parsed.site_domain;

	const supabase = getSupabase();

	const { data: questions, error: qErr } = await supabase
		.from("knowledge_questions")
		.select("id, text, site_domain, created_at")
		.eq("site_domain", siteDomain)
		.eq("status", "approved");

	if (qErr) {
		return Response.json({ error: qErr.message }, { status: 500 });
	}

	const qList = questions ?? [];
	if (qList.length === 0) {
		return Response.json([] satisfies KnowledgeQAPair[]);
	}

	const questionIds = qList.map((q) => q.id);

	const { data: answers, error: aErr } = await supabase
		.from("knowledge_answers")
		.select("id, question_id, workflow_id, answer_text, created_at")
		.in("question_id", questionIds)
		.eq("status", "approved");

	if (aErr) {
		return Response.json({ error: aErr.message }, { status: 500 });
	}

	const ansList = answers ?? [];
	if (ansList.length === 0) {
		return Response.json([] satisfies KnowledgeQAPair[]);
	}

	const answerIds = ansList.map((a) => a.id as string);
	let voteAgg = new Map<string, { thumbs_up_count: number; thumbs_down_count: number; my_vote: KnowledgeVoteValue | null }>();
	if (answerIds.length > 0) {
		const { data: voteRows, error: vErr } = await supabase
			.from("knowledge_answer_votes")
			.select("answer_id, vote, user_id")
			.in("answer_id", answerIds);

		if (vErr) {
			return Response.json({ error: vErr.message }, { status: 500 });
		}

		const rows: VoteRow[] = (voteRows ?? []).map((r) => ({
			answer_id: r.answer_id as string,
			vote: r.vote as KnowledgeVoteValue,
			user_id: r.user_id as string,
		}));
		voteAgg = voteAggregatesByAnswerId(rows, user.user_id);
	}

	const workflowIds = [...new Set(ansList.map((a) => a.workflow_id as string | null).filter((id): id is string => !!id))];
	let wfMap = new Map<string, { id: string; name: string; version: number }>();
	if (workflowIds.length > 0) {
		const { data: workflows, error: wErr } = await supabase.from("workflows").select("id, name, version").in("id", workflowIds);

		if (wErr) {
			return Response.json({ error: wErr.message }, { status: 500 });
		}
		wfMap = new Map(
			(workflows ?? []).map((w) => [
				w.id as string,
				{ id: w.id as string, name: w.name as string, version: Number(w.version) },
			]),
		);
	}

	const qMap = new Map(qList.map((q) => [q.id as string, q]));

	const pairs: KnowledgeQAPair[] = [];
	for (const a of ansList) {
		const q = qMap.get(a.question_id as string);
		if (!q) continue;
		const wfId = a.workflow_id as string | null;
		const w = wfId ? wfMap.get(wfId) : undefined;
		if (wfId && !w) continue;
		const aid = a.id as string;
		const v = voteAgg.get(aid) ?? { thumbs_up_count: 0, thumbs_down_count: 0, my_vote: null };
		pairs.push({
			question: {
				id: q.id as string,
				text: q.text as string,
				site_domain: q.site_domain as string,
				created_at: q.created_at as string,
			},
			answer: {
				id: aid,
				workflow_id: wfId,
				answer_text: (a.answer_text as string | null) ?? null,
				created_at: a.created_at as string,
				thumbs_up_count: v.thumbs_up_count,
				thumbs_down_count: v.thumbs_down_count,
				my_vote: v.my_vote,
			},
			workflow: w ? { id: w.id, name: w.name, version: w.version } : null,
		});
	}

	return Response.json(pairs);
}
