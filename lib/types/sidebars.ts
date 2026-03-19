export interface Sidebar {
	id: string;
	user_id: string;
	window_id: string;
	sidebar_name: string;
	last_seen: string;
	active_project_id: string | null;
	ip_address: string | null;
	created_at: string;
	updated_at: string;
	connected?: boolean;
}

export interface SidebarRegisterBody {
	window_id: string;
	sidebar_name: string;
	active_project_id?: string | null;
}

export interface SidebarUpdateBody {
	sidebar_name?: string;
	active_project_id?: string | null;
}

export interface SidebarDisconnectBody {
	sidebar_id?: string;
	window_id?: string;
}
