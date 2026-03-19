export interface UploadPostAccount {
	id: string;
	user_id: string;
	name: string;
	upload_post_username: string;
	uses_own_key: boolean;
	created_at: string;
	updated_at: string;
	jwt_access_url?: string | null;
	jwt_expires_at?: string | null;
}

export interface UploadPostAccountInsert {
	user_id: string;
	name: string;
	upload_post_username: string;
	uses_own_key?: boolean;
	upload_post_api_key_encrypted?: string | null;
}
