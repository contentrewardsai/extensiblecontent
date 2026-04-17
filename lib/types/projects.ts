export interface Industry {
	id: string;
	name: string;
	created_at: string;
}

export interface Platform {
	id: string;
	name: string;
	slug: string;
	created_at: string;
}

export interface MonetizationOption {
	id: string;
	name: string;
	slug: string;
	created_at: string;
}

export interface Project {
	id: string;
	user_id: string;
	owner_id: string;
	name: string;
	description: string | null;
	quota_bytes: number | null;
	created_at: string;
	updated_at: string;
	industries: Industry[];
	platforms: Platform[];
	monetization: MonetizationOption[];
	role?: "owner" | "editor" | "viewer";
}

export interface ProjectInsert {
	name: string;
	description?: string | null;
	quota_bytes?: number | null;
	industry_ids?: string[];
	platform_ids?: string[];
	monetization_ids?: string[];
}

export interface ProjectUpdate {
	name?: string;
	description?: string | null;
	quota_bytes?: number | null;
	industry_ids?: string[];
	platform_ids?: string[];
	monetization_ids?: string[];
}
