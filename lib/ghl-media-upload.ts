import { getValidTokenForLocation } from "@/lib/ghl";

const GHL_API_BASE = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";

// The medias API uses a different version header than the rest of the 2021-07-28
// surface. If a future version drops support, update this one line.
const MEDIAS_API_VERSION = "2021-07-28";

export interface GhlUploadResult {
	mediaId: string;
	url: string;
	name: string | null;
	locationId: string;
	raw: Record<string, unknown>;
}

/**
 * Upload a file to the user's HighLevel Media Library at the specified
 * location. Uses the same OAuth token store as the rest of `lib/ghl.ts` —
 * `getValidTokenForLocation` verifies the user actually has access to the
 * location and refreshes the token transparently.
 *
 * Endpoint: POST /medias/upload-file (multipart/form-data).
 * Query params altId + altType are required; we always pass altType=location.
 */
/**
 * Import a file into the user's HighLevel Media Library by URL.
 * Uses `hosted=true` + `fileUrl` — the GHL backend fetches the file directly.
 * This avoids sending large blobs through our Vercel serverless functions.
 */
export async function uploadToGhlMediaLibraryByUrl(params: {
	internalUserId: string;
	locationId: string;
	filename: string;
	fileUrl: string;
	/** Optional folder id (parentId) inside the Media Library. */
	parentId?: string | null;
}): Promise<GhlUploadResult> {
	const { token } = await getValidTokenForLocation(params.internalUserId, params.locationId);

	const form = new FormData();
	form.append("hosted", "true");
	form.append("fileUrl", params.fileUrl);
	form.append("name", params.filename);
	if (params.parentId) form.append("parentId", params.parentId);

	const url = new URL(`${GHL_API_BASE}/medias/upload-file`);
	url.searchParams.set("altId", params.locationId);
	url.searchParams.set("altType", "location");

	const res = await fetch(url.toString(), {
		method: "POST",
		headers: {
			Accept: "application/json",
			Version: MEDIAS_API_VERSION,
			Authorization: `Bearer ${token}`,
		},
		body: form,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`GHL media upload-by-url failed (${res.status}): ${text || res.statusText}`);
	}

	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	const mediaId =
		(typeof json.fileId === "string" && json.fileId) ||
		(typeof json._id === "string" && json._id) ||
		(typeof json.id === "string" && json.id) ||
		"";
	const fileUrl = (typeof json.url === "string" && json.url) || (typeof json.fileUrl === "string" && json.fileUrl) || "";
	if (!fileUrl) {
		throw new Error("GHL media upload-by-url succeeded but response did not include a URL");
	}
	return {
		mediaId,
		url: fileUrl,
		name: (typeof json.name === "string" ? json.name : null) ?? params.filename,
		locationId: params.locationId,
		raw: json,
	};
}

export async function uploadToGhlMediaLibrary(params: {
	internalUserId: string;
	locationId: string;
	filename: string;
	contentType: string;
	bytes: ArrayBuffer;
	/** Optional folder id (parentId) inside the Media Library. */
	parentId?: string | null;
}): Promise<GhlUploadResult> {
	const { token } = await getValidTokenForLocation(params.internalUserId, params.locationId);

	const form = new FormData();
	// GHL's `hosted` flag controls whether the API expects a `fileUrl` (hosted=true)
	// or a binary `file` field (hosted=false). We upload the raw bytes, so hosted=false.
	form.append("hosted", "false");
	form.append("name", params.filename);
	if (params.parentId) form.append("parentId", params.parentId);
	form.append("file", new Blob([params.bytes], { type: params.contentType }), params.filename);

	const url = new URL(`${GHL_API_BASE}/medias/upload-file`);
	url.searchParams.set("altId", params.locationId);
	url.searchParams.set("altType", "location");

	const res = await fetch(url.toString(), {
		method: "POST",
		headers: {
			Accept: "application/json",
			Version: MEDIAS_API_VERSION,
			Authorization: `Bearer ${token}`,
		},
		body: form,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`GHL media upload failed (${res.status}): ${text || res.statusText}`);
	}

	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	// Response shape (as of 2021-07-28): { fileId, url, ... } — some deployments
	// return `_id` or `id`. Normalise to a single string so callers don't care.
	const mediaId =
		(typeof json.fileId === "string" && json.fileId) ||
		(typeof json._id === "string" && json._id) ||
		(typeof json.id === "string" && json.id) ||
		"";
	const fileUrl = (typeof json.url === "string" && json.url) || (typeof json.fileUrl === "string" && json.fileUrl) || "";
	if (!fileUrl) {
		throw new Error("GHL media upload succeeded but response did not include a URL");
	}
	return {
		mediaId,
		url: fileUrl,
		name: (typeof json.name === "string" ? json.name : null) ?? params.filename,
		locationId: params.locationId,
		raw: json,
	};
}
