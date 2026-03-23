import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import type { KnowledgeAnswer, KnowledgeAnswerSubmitBody } from "@/lib/types/knowledge";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function workflowKbEligible(w: {
	published: boolean;
	approved: boolean;
	private: boolean;
	archived: boolean;
}): boolean {
	return w.published === true && w.approved === true && w.private === false && w.archived === false;
}

/**
 * POST: Submit an answer — workflow link, text, or both (ExtensionApi.addWorkflowAnswerQA + optional text).
 * Body: { question_id, workflow_id?, text? } — at least one of workflow_id or text (non-empty).
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: KnowledgeAnswerSubmitBody;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (typeof body.question_id !== "string" || !body.question_id.trim()) {
		return Response.json({ error: "question_id is required" }, { status: 400 });
	}

	const workflowIdRaw = typeof body.workflow_id === "string" ? body.workflow_id.trim() : "";
	const workflowId = workflowIdRaw || null;
	const answerTextRaw = typeof body.text === "string" ? body.text.trim() : "";
	const answerText = answerTextRaw || null;

	if (!workflowId && !answerText) {
		return Response.json({ error: "At least one of workflow_id or text is required" }, { status: 400 });
	}

	const supabase = getSupabase();
	const questionId = body.question_id.trim();

	const { data: question, error: qErr } = await supabase.from("knowledge_questions").select("id").eq("id", questionId).maybeSingle();

	if (qErr || !question) {
		return Response.json({ error: "Question not found" }, { status: 404 });
	}

	if (workflowId) {
		const { data: workflow, error: wErr } = await supabase
			.from("workflows")
			.select("id, published, approved, private, archived")
			.eq("id", workflowId)
			.maybeSingle();

		if (wErr || !workflow) {
			return Response.json({ error: "Workflow not found" }, { status: 404 });
		}

		if (!workflowKbEligible(workflow as { published: boolean; approved: boolean; private: boolean; archived: boolean })) {
			return Response.json(
				{
					error:
						"Workflow must be published, approved, public (not private), and not archived to link as a knowledge answer",
				},
				{ status: 400 },
			);
		}
	}

	const now = new Date().toISOString();
	const insertRow: Record<string, unknown> = {
		question_id: questionId,
		submitter_user_id: user.user_id,
		status: "pending",
		updated_at: now,
	};
	if (workflowId) insertRow.workflow_id = workflowId;
	if (answerText) insertRow.answer_text = answerText;

	const { data: row, error } = await supabase.from("knowledge_answers").insert(insertRow).select().single();

	if (error) {
		if (error.code === "23505" || error.message.includes("unique")) {
			return Response.json({ error: "This workflow is already linked to this question" }, { status: 409 });
		}
		if (error.message.includes("workflow must be published") || error.message.includes("knowledge_answers_workflow_or_text_chk")) {
			if (error.message.includes("knowledge_answers_workflow_or_text_chk")) {
				return Response.json({ error: "At least one of workflow_id or text is required" }, { status: 400 });
			}
			return Response.json(
				{
					error:
						"Workflow must be published, approved, public (not private), and not archived to link as a knowledge answer",
				},
				{ status: 400 },
			);
		}
		return Response.json({ error: error.message }, { status: 500 });
	}

	if (!row) {
		return Response.json({ error: "Failed to create answer" }, { status: 500 });
	}

	return Response.json(row as KnowledgeAnswer);
}
