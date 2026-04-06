import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import type { KnowledgeAnswer, KnowledgeAnswerSubmitBody } from "@/lib/types/knowledge";
import { userCanAccessWorkflow } from "@/lib/workflow-user-access";

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
 * Body: { question_id, workflow_id?, text?, for_review? } — at least one of workflow_id or text (non-empty).
 * With for_review: true, workflow_id is required; catalog eligibility is skipped for the workflow owner / added_by;
 * row is pending until moderated; public QA requires approval and a KB-eligible workflow (DB-enforced on approve).
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

	const forReview = body.for_review === true;
	const workflowIdRaw = typeof body.workflow_id === "string" ? body.workflow_id.trim() : "";
	const workflowId = workflowIdRaw || null;
	const answerTextRaw = typeof body.text === "string" ? body.text.trim() : "";
	const answerText = answerTextRaw || null;

	if (forReview && !workflowId) {
		return Response.json({ error: "for_review requires workflow_id" }, { status: 400 });
	}

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
			.select("id, published, approved, private, archived, created_by")
			.eq("id", workflowId)
			.maybeSingle();

		if (wErr || !workflow) {
			return Response.json({ error: "Workflow not found" }, { status: 404 });
		}

		const wf = workflow as {
			published: boolean;
			approved: boolean;
			private: boolean;
			archived: boolean;
			created_by: string;
		};

		if (forReview) {
			const canPropose = await userCanAccessWorkflow(supabase, { created_by: wf.created_by }, workflowId, user.user_id);
			if (!canPropose) {
				return Response.json({ error: "Workflow not found" }, { status: 404 });
			}
		} else if (!workflowKbEligible(wf)) {
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
		workflow_kb_check_bypass: forReview && !!workflowId,
	};
	if (workflowId) insertRow.workflow_id = workflowId;
	if (answerText) insertRow.answer_text = answerText;

	const { data: row, error } = await supabase.from("knowledge_answers").insert(insertRow).select().single();

	if (error) {
		if (isPostgresUniqueViolation(error)) {
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

	const payload: KnowledgeAnswer = { ...(row as KnowledgeAnswer) };
	if (payload.workflow_kb_check_bypass) {
		payload.submission_kind = "workflow_pending_catalog";
	}

	return Response.json(payload);
}
