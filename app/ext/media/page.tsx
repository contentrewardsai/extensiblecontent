import { cookies } from "next/headers";
import { readWhopUserCookie, WHOP_USER_COOKIE } from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";
import Link from "next/link";
import { ShotstackTemplateGalleryClient } from "@/app/experiences/[experienceId]/media/components/template-gallery-client";
import type { GalleryTemplate } from "@/app/experiences/[experienceId]/media/components/template-gallery";

type SearchParams = { location_id?: string; locationId?: string; company_id?: string; companyId?: string };

export default async function GhlMediaGalleryPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const sp = await searchParams;
	const locationId = sp.location_id || sp.locationId || "";
	const companyId = sp.company_id || sp.companyId || "";

	const cookieStore = await cookies();
	const raw = cookieStore.get(WHOP_USER_COOKIE)?.value;
	const internalUserId = readWhopUserCookie(raw);

	if (!internalUserId) {
		const settingsQs = new URLSearchParams();
		if (locationId) settingsQs.set("location_id", locationId);
		if (companyId) settingsQs.set("company_id", companyId);
		return (
			<div style={{ fontFamily: "system-ui", maxWidth: 640, margin: "40px auto", padding: 24, border: "1px solid #e1e4e8", borderRadius: 12, background: "#fff" }}>
				<h1 style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>Link your Whop account</h1>
				<p style={{ fontSize: 14, color: "#333", marginTop: 12 }}>Connect your Whop account to access templates.</p>
				<Link
					href={`/ext/settings${settingsQs.toString() ? `?${settingsQs.toString()}` : ""}`}
					style={{ display: "inline-block", marginTop: 16, padding: "10px 18px", borderRadius: 8, background: "#2563eb", color: "#fff", fontSize: 14, fontWeight: 500, textDecoration: "none" }}
				>
					Open settings
				</Link>
			</div>
		);
	}

	const supabase = getServiceSupabase();
	const { data: memberRows } = await supabase
		.from("project_members")
		.select("project_id")
		.eq("user_id", internalUserId);
	const memberProjectIds = Array.from(
		new Set(
			((memberRows ?? []) as Array<{ project_id: string | null }>)
				.map((r) => r.project_id)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	);
	const orParts: string[] = [`user_id.eq.${internalUserId}`, "is_builtin.eq.true"];
	if (memberProjectIds.length > 0) {
		orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	}
	const { data: templates } = await supabase
		.from("shotstack_templates")
		.select("id, user_id, name, default_env, is_builtin, source_path, thumbnail_url, thumbnail_updated_at, updated_at")
		.or(orParts.join(","))
		.order("is_builtin", { ascending: true })
		.order("updated_at", { ascending: false });

	const galleryTemplates: GalleryTemplate[] = (templates ?? []).map((t) => ({
		id: t.id,
		user_id: t.user_id,
		name: t.name,
		default_env: t.default_env,
		is_builtin: !!t.is_builtin,
		source_path: t.source_path,
		thumbnail_url: t.thumbnail_url,
		thumbnail_updated_at: t.thumbnail_updated_at,
		updated_at: t.updated_at,
	}));

	const qsParts: string[] = [];
	if (locationId) qsParts.push(`locationId=${encodeURIComponent(locationId)}`);
	if (companyId) qsParts.push(`companyId=${encodeURIComponent(companyId)}`);
	const templatesApiQuery = qsParts.join("&");

	return (
		<div style={{ maxWidth: 1280, margin: "0 auto", padding: 16, fontFamily: "system-ui, -apple-system, sans-serif" }}>
			<h2 style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>Templates</h2>
			<p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Click any tile to preview, edit, clone, or delete.</p>
			<div style={{ marginTop: 16 }}>
				<ShotstackTemplateGalleryClient
					templates={galleryTemplates}
					actions={{ templatesApiBase: "/api/ghl/shotstack-templates", templatesApiQuery }}
					editorUrlPrefix="/ext/media/editor"
					allowCreate={false}
				/>
			</div>
		</div>
	);
}
