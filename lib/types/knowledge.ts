export type KnowledgeModerationStatus = "pending" | "approved" | "rejected";

export interface KnowledgeQuestion {
	id: string;
	user_id: string;
	text: string;
	site_domain: string;
	status: KnowledgeModerationStatus;
	created_at: string;
	updated_at: string;
	moderated_at: string | null;
	moderated_by: string | null;
	moderation_note: string | null;
}

export interface KnowledgeAnswer {
	id: string;
	question_id: string;
	/** Set when this answer links a catalog workflow; null for text-only answers. */
	workflow_id: string | null;
	/** Free-text answer; may be combined with workflow_id. */
	answer_text: string | null;
	submitter_user_id: string;
	status: KnowledgeModerationStatus;
	created_at: string;
	updated_at: string;
	moderated_at: string | null;
	moderated_by: string | null;
	moderation_note: string | null;
}

export interface KnowledgeQuestionSubmitBody {
	text: string;
	origin?: string;
	hostname?: string;
	domain?: string;
}

/** At least one of workflow_id or text (non-empty) is required. */
export interface KnowledgeAnswerSubmitBody {
	question_id: string;
	workflow_id?: string;
	/** Plain-language answer; optional if workflow_id is set, required otherwise. */
	text?: string;
}

/** Minimal workflow fields returned with public Q&A (no workflow JSON body). */
export interface KnowledgeWorkflowSummary {
	id: string;
	name: string;
	version: number;
}

export type KnowledgeVoteValue = "up" | "down";

export interface KnowledgeVoteSubmitBody {
	answer_id: string;
	direction: KnowledgeVoteValue | "none";
}

export interface KnowledgeQAPair {
	question: Pick<KnowledgeQuestion, "id" | "text" | "site_domain" | "created_at">;
	answer: Pick<KnowledgeAnswer, "id" | "workflow_id" | "answer_text" | "created_at"> & {
		thumbs_up_count: number;
		thumbs_down_count: number;
		/** Caller's vote, or null if they have not voted. */
		my_vote: KnowledgeVoteValue | null;
	};
	/** Present when answer.workflow_id is set; null for text-only answers. */
	workflow: KnowledgeWorkflowSummary | null;
}
