import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export async function GET(_request: NextRequest) {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		return Response.json({ error: "Supabase not configured" }, { status: 500 });
	}

	const supabase = createClient(url, key);
	const { data, error } = await supabase.from("monetization_options").select("id, name, slug, created_at").order("name");

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json(data ?? []);
}
