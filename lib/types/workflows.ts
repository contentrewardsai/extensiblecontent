export interface Workflow {
	id: string;
	created_by: string;
	name: string;
	workflow: Record<string, unknown>;
	private: boolean;
	published: boolean;
	/** Curator-approved; required with published + public for knowledge-base answer links. */
	approved: boolean;
	version: number;
	initial_version: string | null;
	archived: boolean;
	/** Optional project this workflow belongs to. Members of the project see it via /api/extension/workflows. */
	project_id: string | null;
	created_at: string;
	updated_at: string;
	added_by: { user_id: string }[];
}

export interface WorkflowInsert {
	id?: string;
	name: string;
	workflow: Record<string, unknown>;
	private?: boolean;
	published?: boolean;
	approved?: boolean;
	version?: number;
	initial_version?: string | null;
	added_by?: string[];
	/** Attach this workflow to a project the caller can edit. Optional. */
	project_id?: string | null;
}

export interface WorkflowUpdate {
	name?: string;
	workflow?: Record<string, unknown>;
	private?: boolean;
	published?: boolean;
	approved?: boolean;
	version?: number;
	initial_version?: string | null;
	added_by?: string[];
	project_id?: string | null;
}
