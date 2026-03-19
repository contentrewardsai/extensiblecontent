export interface UploadPostAccount {
	id: string;
	user_id: string;
	name: string;
	upload_post_username: string;
	uses_own_key: boolean;
	created_at: string;
	updated_at: string;
}

export interface UploadPostAccountInsert {
	user_id: string;
	name: string;
	upload_post_username: string;
	uses_own_key?: boolean;
}
