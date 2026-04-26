import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { getSpendableCredits } from "@/lib/shotstack-ledger";

/**
 * GET /api/ghl/page-context?companyId=...
 * GET /api/ghl/page-context?locationId=...
 * GET /api/ghl/page-context?userId=...
 *
 * Returns all user data for the GHL Custom Page settings view.
 * Resolves the Whop userId from whichever GHL identifier is provided
 * by looking up the backend link in ghl_connections / ghl_locations.
 */
export async function GET(request: NextRequest) {
	const companyId = request.nextUrl.searchParams.get("companyId");
	const locationId = request.nextUrl.searchParams.get("locationId");
	const directUserId = request.nextUrl.searchParams.get("userId");

	if (!companyId && !locationId && !directUserId) {
		return Response.json(
			{ error: "companyId, locationId, or userId is required" },
			{ status: 400 },
		);
	}

	const supabase = getServiceSupabase();
	let locationName: string | null = null;

	// In the many-to-many model, a GHL company / location may have multiple
	// linked Whop users, so we can't pick one from companyId alone. The caller
	// must provide directUserId (typically stored in a cookie or passed via
	// postMessage after Whop OAuth). If only companyId/locationId is provided,
	// we simply report whether ANY link exists so the UI can show the
	// "Link Whop Account" button if needed.
	if (!directUserId) {
		let anyLink = false;
		if (companyId) {
			const { data: conn } = await supabase
				.from("ghl_connections")
				.select("id")
				.eq("company_id", companyId)
				.maybeSingle();
			if (conn) {
				const { count } = await supabase
					.from("ghl_connection_users")
					.select("*", { count: "exact", head: true })
					.eq("connection_id", conn.id);
				anyLink = (count ?? 0) > 0;
			}
		} else if (locationId) {
			const { data: loc } = await supabase
				.from("ghl_locations")
				.select("connection_id, location_name")
				.eq("location_id", locationId)
				.maybeSingle();
			if (loc) {
				locationName = loc.location_name;
				const { count } = await supabase
					.from("ghl_connection_users")
					.select("*", { count: "exact", head: true })
					.eq("connection_id", loc.connection_id);
				anyLink = (count ?? 0) > 0;
			}
		}

		return Response.json({
			whopLinked: false,
			hasAnyLink: anyLink,
			companyId: companyId ?? null,
			locationId: locationId ?? null,
			locationName,
		});
	}

	const userId = directUserId;

	// If companyId or locationId was also provided, verify this user actually
	// has access via the join table. Collect every connection_id that matches
	// the given GHL context (historical data may have split teammates across
	// multiple rows) and check for access against any of them.
	if (companyId || locationId) {
		const connectionIds = new Set<string>();

		if (companyId) {
			const { data: byCompany } = await supabase
				.from("ghl_connections")
				.select("id")
				.eq("company_id", companyId);
			for (const c of byCompany ?? []) connectionIds.add(c.id);
		}

		if (locationId) {
			const { data: byLocation } = await supabase
				.from("ghl_locations")
				.select("connection_id, location_name")
				.eq("location_id", locationId);
			for (const l of byLocation ?? []) {
				if (l.connection_id) connectionIds.add(l.connection_id);
				if (l.location_name) locationName = l.location_name;
			}
			const { data: bySynthetic } = await supabase
				.from("ghl_connections")
				.select("id")
				.eq("company_id", `loc:${locationId}`);
			for (const c of bySynthetic ?? []) connectionIds.add(c.id);
		}

		if (connectionIds.size > 0) {
			const { data: access } = await supabase
				.from("ghl_connection_users")
				.select("id")
				.in("connection_id", Array.from(connectionIds))
				.eq("user_id", userId)
				.limit(1);

			if (!access || access.length === 0) {
				return Response.json({
					whopLinked: false,
					hasAnyLink: true,
					companyId: companyId ?? null,
					locationId: locationId ?? null,
					locationName,
				});
			}
		}
	}

	// Load all data in parallel
	const [userRes, workflowsRes, templatesRes, uploadPostCountRes, spendableCredits] =
		await Promise.all([
			supabase
				.from("users")
				.select(
					"id, name, email, has_upgraded, max_upload_post_accounts, max_storage_bytes, shotstack_api_key_encrypted",
				)
				.eq("id", userId)
				.single(),
			supabase
				.from("workflows")
				.select("id, name, version, private, published, archived, created_at")
				.eq("created_by", userId)
				.eq("archived", false)
				.order("created_at", { ascending: false })
				.limit(50),
			supabase
				.from("shotstack_templates")
				.select("id, name, default_env, created_at, updated_at")
				.eq("user_id", userId)
				.order("updated_at", { ascending: false }),
			supabase
				.from("upload_post_accounts")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId),
			getSpendableCredits(supabase, userId),
		]);

	const user = userRes.data;
	if (!user) {
		return Response.json({
			whopLinked: false,
			locationId: locationId ?? null,
			locationName,
		});
	}

	return Response.json({
		whopLinked: true,
		locationId: locationId ?? null,
		locationName,
		user: {
			name: user.name,
			email: user.email,
			hasUpgraded: !!user.has_upgraded,
			maxUploadPostAccounts: user.max_upload_post_accounts ?? 0,
			maxStorageBytes: user.max_storage_bytes ?? 0,
			hasByok: !!user.shotstack_api_key_encrypted?.trim(),
		},
		workflows: workflowsRes.data ?? [],
		templates: templatesRes.data ?? [],
		shotstack: {
			spendableCredits: spendableCredits,
			hasByok: !!user.shotstack_api_key_encrypted?.trim(),
		},
		uploadPostAccounts: uploadPostCountRes.count ?? 0,
	});
}
