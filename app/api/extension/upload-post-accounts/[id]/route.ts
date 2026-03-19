import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { deleteUploadPostProfile } from "@/lib/upload-post";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function getUploadPostKey(): string | null {
	return process.env.UPLOAD_POST_API_KEY ?? null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.select("*")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (error || !account) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	return Response.json(account);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	let body: { name?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const supabase = getSupabase();
	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (body.name != null && typeof body.name === "string" && body.name.trim()) {
		updates.name = body.name.trim();
	}

	if (Object.keys(updates).length <= 1) {
		return Response.json({ error: "No updates provided" }, { status: 400 });
	}

	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.update(updates)
		.eq("id", id)
		.eq("user_id", user.user_id)
		.select()
		.single();

	if (error) return Response.json({ error: error.message }, { status: 500 });
	if (!account) return Response.json({ error: "Not found" }, { status: 404 });

	return Response.json(account);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { data: account, error: fetchError } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (fetchError || !account) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	// Delete from Upload-Post (use our key for managed accounts)
	const apiKey = getUploadPostKey();
	if (apiKey && !account.uses_own_key) {
		try {
			await deleteUploadPostProfile(account.upload_post_username, apiKey);
		} catch (err) {
			console.error("[upload-post] delete profile failed:", err);
			// Continue to delete locally - profile may already be gone
		}
	}

	const { error: deleteError } = await supabase
		.from("upload_post_accounts")
		.delete()
		.eq("id", id)
		.eq("user_id", user.user_id);

	if (deleteError) return Response.json({ error: deleteError.message }, { status: 500 });
	return Response.json({ success: true });
}
