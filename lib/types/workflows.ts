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
}
