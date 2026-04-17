import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { listProjectAuditEntries } from "@/lib/project-audit";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function accessErrorResponse(e: unknown) {
	if (e instanceof ProjectAccessError) {
		return Response.json({ error: e.message }, { status: e.status });
	}
	return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	try {
		await assertProjectAccess(supabase, id, user.user_id, "viewer");
	} catch (e) {
		return accessErrorResponse(e);
	}

	const limitParam = request.nextUrl.searchParams.get("limit");
	const offsetParam = request.nextUrl.searchParams.get("offset");
	const limit = Math.min(Math.max(Number(limitParam) || 50, 1), 200);
	const offset = Math.max(Number(offsetParam) || 0, 0);

	const entries = await listProjectAuditEntries(supabase, id, { limit, offset });
	return Response.json({ entries, limit, offset });
}
