/**
 * Upload-Post API service.
 * - Create user profiles, generate JWT URLs for connecting social accounts
 * - Supports managed key (our UPLOAD_POST_API_KEY) and BYOK (user's key per account)
 */

const UPLOAD_POST_BASE = "https://api.upload-post.com";

export interface CreateProfileResponse {
	success: boolean;
	profile?: { username: string; created_at: string; social_accounts: Record<string, unknown> };
}

export interface GenerateJwtResponse {
	success: boolean;
	access_url?: string;
	duration?: string;
}

export interface UploadPostProfile {
	username: string;
	created_at: string;
	social_accounts: Record<string, unknown>;
}

export interface GetProfilesResponse {
	success: boolean;
	profiles?: UploadPostProfile[];
}

async function uploadPostFetch<T>(
	endpoint: string,
	options: RequestInit & { apiKey: string }
): Promise<T> {
	const { apiKey, ...fetchOpts } = options;
	const res = await fetch(`${UPLOAD_POST_BASE}${endpoint}`, {
		...fetchOpts,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Apikey ${apiKey}`,
			...fetchOpts.headers,
		},
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Upload-Post API error: ${res.status} ${err}`);
	}

	return res.json() as Promise<T>;
}

/** Create a user profile in Upload-Post. */
export async function createUploadPostProfile(
	username: string,
	apiKey: string
): Promise<CreateProfileResponse> {
	return uploadPostFetch<CreateProfileResponse>("/api/uploadposts/users", {
		method: "POST",
		apiKey,
		body: JSON.stringify({ username }),
	});
}

/** Generate JWT URL for user to connect social accounts. */
export async function generateUploadPostJwt(
	username: string,
	apiKey: string,
	opts?: {
		redirect_url?: string;
		logo_image?: string;
		connect_title?: string;
		connect_description?: string;
		platforms?: string[];
		show_calendar?: boolean;
		readonly_calendar?: boolean;
	}
): Promise<GenerateJwtResponse> {
	return uploadPostFetch<GenerateJwtResponse>("/api/uploadposts/users/generate-jwt", {
		method: "POST",
		apiKey,
		body: JSON.stringify({ username, ...opts }),
	});
}

/** Get a single profile by username. */
export async function getUploadPostProfile(username: string, apiKey: string): Promise<UploadPostProfile | null> {
	const res = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/users/${encodeURIComponent(username)}`, {
		headers: { Authorization: `Apikey ${apiKey}` },
	});
	if (!res.ok) {
		if (res.status === 404) return null;
		const err = await res.text();
		throw new Error(`Upload-Post API error: ${res.status} ${err}`);
	}
	const data = (await res.json()) as { success: boolean; profile?: UploadPostProfile };
	return data.profile ?? null;
}

/** Delete a user profile. */
export async function deleteUploadPostProfile(username: string, apiKey: string): Promise<void> {
	await uploadPostFetch<{ success: boolean }>("/api/uploadposts/users", {
		method: "DELETE",
		apiKey,
		body: JSON.stringify({ username }),
	});
}
