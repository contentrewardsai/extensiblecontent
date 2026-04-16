import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getIngestSourceStatus, deleteIngestSource } from "@/lib/shotstack-ingest";
import type { ShotStackEnv } from "@/lib/shotstack";

/**
 * GET: Poll ingest source status.
 * Query: ?env=stage|v1
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { sourceId } = await params;
	const env = (request.nextUrl.searchParams.get("env") === "v1" ? "v1" : "stage") as ShotStackEnv;

	const status = await getIngestSourceStatus(sourceId, env);
	if (!status) {
		return Response.json({ error: "Source not found or ShotStack not configured" }, { status: 404 });
	}

	return Response.json(status);
}

/**
 * DELETE: Delete an ingested source.
 * Query: ?env=stage|v1
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { sourceId } = await params;
	const env = (request.nextUrl.searchParams.get("env") === "v1" ? "v1" : "stage") as ShotStackEnv;

	const success = await deleteIngestSource(sourceId, env);
	if (!success) {
		return Response.json({ error: "Failed to delete source or ShotStack not configured" }, { status: 500 });
	}

	return new Response(null, { status: 204 });
}
