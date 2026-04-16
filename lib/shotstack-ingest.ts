import type { ShotStackEnv } from "@/lib/shotstack";

const SHOTSTACK_INGEST_BASE = "https://api.shotstack.io/ingest";

function getIngestApiKey(env: ShotStackEnv): string | null {
	return env === "stage"
		? process.env.SHOTSTACK_STAGING_API_KEY ?? null
		: process.env.SHOTSTACK_API_KEY ?? null;
}

function getVersion(env: ShotStackEnv): string {
	return env === "stage" ? "stage" : "v1";
}

export interface IngestUploadResponse {
	data: {
		type: string;
		id: string;
		attributes: {
			id: string;
			url: string;
			status: string;
			expires: string;
		};
	};
}

export interface IngestSourceResponse {
	data: {
		type: string;
		id: string;
		attributes: {
			id: string;
			owner: string;
			input: string;
			source: string;
			status: string;
			url?: string;
			width?: number;
			height?: number;
			fps?: number;
			duration?: number;
			created: string;
			updated: string;
		};
	};
}

export interface IngestSourceListResponse {
	data: Array<{
		type: string;
		id: string;
		attributes: Record<string, unknown>;
	}>;
}

/**
 * Request a signed upload URL from ShotStack Ingest API.
 */
export async function requestIngestUploadUrl(
	env: ShotStackEnv,
	apiKey?: string | null,
): Promise<IngestUploadResponse | null> {
	const key = apiKey ?? getIngestApiKey(env);
	if (!key) return null;

	const version = getVersion(env);
	const res = await fetch(`${SHOTSTACK_INGEST_BASE}/${version}/upload`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"x-api-key": key,
		},
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`ShotStack ingest upload request failed: ${res.status} ${err}`);
	}

	return res.json() as Promise<IngestUploadResponse>;
}

/**
 * Upload binary data to a signed ShotStack S3 URL.
 */
export async function uploadToSignedUrl(
	signedUrl: string,
	data: Uint8Array,
	contentType?: string,
): Promise<void> {
	const headers: Record<string, string> = {};
	if (contentType) headers["Content-Type"] = contentType;

	const res = await fetch(signedUrl, {
		method: "PUT",
		headers,
		body: data as unknown as BodyInit,
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`ShotStack S3 upload failed: ${res.status} ${err}`);
	}
}

/**
 * Get the status of an ingested source.
 */
export async function getIngestSourceStatus(
	sourceId: string,
	env: ShotStackEnv,
	apiKey?: string | null,
): Promise<IngestSourceResponse | null> {
	const key = apiKey ?? getIngestApiKey(env);
	if (!key) return null;

	const version = getVersion(env);
	const res = await fetch(`${SHOTSTACK_INGEST_BASE}/${version}/sources/${sourceId}`, {
		headers: {
			Accept: "application/json",
			"x-api-key": key,
		},
	});

	if (!res.ok) return null;
	return res.json() as Promise<IngestSourceResponse>;
}

/**
 * List all ingested sources.
 */
export async function listIngestSources(
	env: ShotStackEnv,
	apiKey?: string | null,
): Promise<IngestSourceListResponse | null> {
	const key = apiKey ?? getIngestApiKey(env);
	if (!key) return null;

	const version = getVersion(env);
	const res = await fetch(`${SHOTSTACK_INGEST_BASE}/${version}/sources`, {
		headers: {
			Accept: "application/json",
			"x-api-key": key,
		},
	});

	if (!res.ok) return null;
	return res.json() as Promise<IngestSourceListResponse>;
}

/**
 * Delete an ingested source.
 */
export async function deleteIngestSource(
	sourceId: string,
	env: ShotStackEnv,
	apiKey?: string | null,
): Promise<boolean> {
	const key = apiKey ?? getIngestApiKey(env);
	if (!key) return false;

	const version = getVersion(env);
	const res = await fetch(`${SHOTSTACK_INGEST_BASE}/${version}/sources/${sourceId}`, {
		method: "DELETE",
		headers: { "x-api-key": key },
	});

	return res.status === 204 || res.ok;
}
