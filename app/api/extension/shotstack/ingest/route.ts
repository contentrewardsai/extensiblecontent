import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import {
	requestIngestUploadUrl,
	uploadToSignedUrl,
	listIngestSources,
} from "@/lib/shotstack-ingest";
import type { ShotStackEnv } from "@/lib/shotstack";

/**
 * POST: Upload source media for ShotStack ingest.
 * Body: { base64Data, environment }
 * The backend requests a signed URL, uploads the decoded binary, returns the source ID.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { base64Data: string; environment?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body.base64Data) {
		return Response.json({ error: "base64Data is required" }, { status: 400 });
	}

	const env = (body.environment === "v1" ? "v1" : "stage") as ShotStackEnv;

	let uploadResponse;
	try {
		uploadResponse = await requestIngestUploadUrl(env);
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Failed to request upload URL";
		return Response.json({ error: msg }, { status: 500 });
	}

	if (!uploadResponse) {
		return Response.json({ error: "ShotStack not configured" }, { status: 503 });
	}

	const signedUrl = uploadResponse.data.attributes.url;
	const sourceId = uploadResponse.data.attributes.id;

	try {
		const raw = atob(body.base64Data);
		const binaryData = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) binaryData[i] = raw.charCodeAt(i);
		await uploadToSignedUrl(signedUrl, binaryData);
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Upload to ShotStack failed";
		return Response.json({ error: msg }, { status: 500 });
	}

	return Response.json({
		ok: true,
		sourceId,
	});
}

/**
 * GET: List ingested sources.
 * Query: ?env=stage|v1
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const env = (request.nextUrl.searchParams.get("env") === "v1" ? "v1" : "stage") as ShotStackEnv;

	const sources = await listIngestSources(env);
	if (!sources) {
		return Response.json({ error: "ShotStack not configured" }, { status: 503 });
	}

	return Response.json(sources);
}
