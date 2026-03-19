/**
 * ShotStack video render service.
 * - Staging: use stage version + SHOTSTACK_STAGING_API_KEY
 * - Production: use v1 + user's key (BYOK) or SHOTSTACK_API_KEY (managed)
 * - Credits: 1 per minute, billed by second. We track ourselves (no ShotStack credits API).
 */

const SHOTSTACK_BASE = "https://api.shotstack.io/edit";

export type ShotStackEnv = "stage" | "v1";

export interface ShotStackRenderOptions {
	/** Use staging/sandbox (watermarked) or production */
	env?: ShotStackEnv;
	/** User's own API key (BYOK); if null, use managed key */
	apiKey?: string | null;
	/** Timeline + output JSON for the render */
	edit: Record<string, unknown>;
}

export interface ShotStackRenderResponse {
	id: string;
	owner: string;
	url?: string;
	status: "queued" | "fetching" | "rendering" | "saving" | "done" | "failed";
	error?: string;
}

export interface ShotStackStatusResponse {
	id: string;
	owner: string;
	url?: string;
	status: "queued" | "fetching" | "rendering" | "saving" | "done" | "failed";
	error?: string;
}

function getApiKey(options: ShotStackRenderOptions): string | null {
	if (options.apiKey) return options.apiKey;
	const env = options.env ?? "v1";
	return env === "stage"
		? process.env.SHOTSTACK_STAGING_API_KEY ?? null
		: process.env.SHOTSTACK_API_KEY ?? null;
}

function getVersion(env: ShotStackEnv): string {
	return env === "stage" ? "stage" : "v1";
}

export async function renderShotStack(options: ShotStackRenderOptions): Promise<ShotStackRenderResponse | null> {
	const apiKey = getApiKey(options);
	if (!apiKey) return null;

	const env = options.env ?? "v1";
	const version = getVersion(env);

	const res = await fetch(`${SHOTSTACK_BASE}/${version}/render`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
		},
		body: JSON.stringify(options.edit),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`ShotStack render failed: ${res.status} ${err}`);
	}

	return res.json() as Promise<ShotStackRenderResponse>;
}

export async function getShotStackStatus(
	renderId: string,
	options: { env?: ShotStackEnv; apiKey?: string | null }
): Promise<ShotStackStatusResponse | null> {
	const apiKey = options.apiKey ?? (options.env === "stage" ? process.env.SHOTSTACK_STAGING_API_KEY : process.env.SHOTSTACK_API_KEY) ?? null;
	if (!apiKey) return null;

	const env = options.env ?? "v1";
	const version = getVersion(env);

	const res = await fetch(`${SHOTSTACK_BASE}/${version}/render/${renderId}`, {
		headers: { "x-api-key": apiKey },
	});

	if (!res.ok) return null;
	return res.json() as Promise<ShotStackStatusResponse>;
}

/** Compute credits from duration in seconds. 1 credit = 60 seconds, billed by second. */
export function creditsFromSeconds(seconds: number): number {
	return Math.ceil((seconds * 100) / 60) / 100; // round up to 2 decimals
}
