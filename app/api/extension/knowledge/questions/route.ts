import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { siteDomainFromBody } from "@/lib/knowledge-domain";
import type { KnowledgeQuestion, KnowledgeQuestionSubmitBody } from "@/lib/types/knowledge";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/** POST: Submit a question (pending moderation). */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: KnowledgeQuestionSubmitBody;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (typeof body.text !== "string" || !body.text.trim()) {
		return Response.json({ error: "text is required" }, { status: 400 });
	}

	const domainRes = siteDomainFromBody({
		origin: body.origin,
		hostname: body.hostname,
		domain: body.domain,
	});
	if (!domainRes.ok) {
		return Response.json({ error: domainRes.error }, { status: 400 });
	}

	const supabase = getSupabase();
	const now = new Date().toISOString();
	const { data: row, error } = await supabase
		.from("knowledge_questions")
		.insert({
			user_id: user.user_id,
			text: body.text.trim(),
			site_domain: domainRes.site_domain,
			status: "pending",
			updated_at: now,
		})
		.select()
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Failed to create question" }, { status: 500 });
	}

	return Response.json(row as KnowledgeQuestion);
}
