import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";
import { renderShotStack, getShotStackStatus } from "@/lib/shotstack";

const SUMMER_HOLIDAY_TEMPLATE = join(process.cwd(), "scripts", "summer-holiday-template.json");

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Backend-only ShotStack staging test.
 * Uses SHOTSTACK_STAGING_API_KEY from env. Protected by X-Test-Secret header.
 *
 * Submits the Summer Holiday template to ShotStack staging, stores in shotstack_renders,
 * and optionally polls until done (wait=true) then returns the output URL.
 *
 * Set SHOTSTACK_TEST_SECRET in Vercel to enable. Use a test user or set SHOTSTACK_TEST_USER_ID.
 */
export async function POST(request: NextRequest) {
	const secret = request.headers.get("X-Test-Secret") ?? request.nextUrl.searchParams.get("secret");
	if (secret !== process.env.SHOTSTACK_TEST_SECRET) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const apiKey = process.env.SHOTSTACK_STAGING_API_KEY;
	if (!apiKey) {
		return Response.json({ error: "SHOTSTACK_STAGING_API_KEY not configured" }, { status: 503 });
	}

	const wait = request.nextUrl.searchParams.get("wait") === "true";

	const supabase = getSupabase();

	// Get or create test user for shotstack_renders
	let userId: string;
	const testUserId = process.env.SHOTSTACK_TEST_USER_ID;
	if (testUserId) {
		const { data } = await supabase.from("users").select("id").eq("id", testUserId).single();
		if (!data) {
			return Response.json({ error: "SHOTSTACK_TEST_USER_ID not found in users" }, { status: 500 });
		}
		userId = data.id;
	} else {
		await supabase
			.from("users")
			.upsert(
				{
					email: "shotstack-test@extensiblecontent.local",
					name: "ShotStack Test",
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "email" }
			);
		const { data: testUser } = await supabase
			.from("users")
			.select("id")
			.eq("email", "shotstack-test@extensiblecontent.local")
			.single();
		if (!testUser?.id) {
			return Response.json({ error: "Could not get or create test user" }, { status: 500 });
		}
		userId = testUser.id;
	}

	const edit = JSON.parse(readFileSync(SUMMER_HOLIDAY_TEMPLATE, "utf-8"));

	const result = await renderShotStack({ edit, env: "stage", apiKey });
	if (!result) {
		return Response.json({ error: "ShotStack render failed" }, { status: 500 });
	}

	await supabase.from("shotstack_renders").insert({
		user_id: userId,
		shotstack_render_id: result.id,
		request_json: edit,
		status: result.status,
		credits_used: 0,
		env: "stage",
	});

	let status = result;
	if (wait) {
		while (status.status !== "done" && status.status !== "failed") {
			await new Promise((r) => setTimeout(r, 3000));
			const next = await getShotStackStatus(result.id, { env: "stage" });
			if (!next) break;
			status = next;
			if (status.status === "done" && status.url) {
				await supabase
					.from("shotstack_renders")
					.update({ status: "done", output_url: status.url, updated_at: new Date().toISOString() })
					.eq("shotstack_render_id", result.id)
					.eq("user_id", userId);
			}
		}
	}

	return Response.json({
		id: result.id,
		status: status.status,
		url: status.url,
		error: status.error,
	});
}
