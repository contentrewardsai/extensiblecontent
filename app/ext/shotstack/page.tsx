import Link from "next/link";
import { cookies } from "next/headers";
import { readWhopUserCookie, WHOP_USER_COOKIE } from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";
import type { GalleryTemplate } from "@/app/experiences/[experienceId]/shotstack/shotstack-template-gallery";
import { ShotstackTemplateGalleryClient } from "@/app/experiences/[experienceId]/shotstack/shotstack-template-gallery-client";

type SearchParams = { location_id?: string; locationId?: string; company_id?: string; companyId?: string };

/**
 * GHL template gallery. Same tile / preview-card / clone / delete UX as the
 * Whop experience page, authenticated via the signed `ec_whop_user` cookie.
 *
 * If the browser has no cookie we bounce the user to `/ext/settings` so they
 * can link / pick a Whop account first; once linked they land back here.
 */
export default async function GhlShotstackTemplatesPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const sp = await searchParams;
	const locationId = sp.location_id || sp.locationId || "";
	const companyId = sp.company_id || sp.companyId || "";

	const cookieStore = await cookies();
	const internalUserId = readWhopUserCookie(cookieStore.get(WHOP_USER_COOKIE)?.value);

	if (!internalUserId) {
		const settingsQs = new URLSearchParams();
		if (locationId) settingsQs.set("location_id", locationId);
		if (companyId) settingsQs.set("company_id", companyId);
		return (
			<div style={containerStyle}>
				<h1 style={titleStyle}>Link your Whop account to see templates</h1>
				<p style={bodyStyle}>
					Open the Extensible Content settings page and link a Whop account.
					Your ShotStack templates will appear here as a visual gallery.
				</p>
				<Link
					href={`/ext/settings${settingsQs.toString() ? `?${settingsQs.toString()}` : ""}`}
					style={linkBtnStyle}
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
	if (memberProjectIds.length > 0) orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);

	const { data } = await supabase
		.from("shotstack_templates")
		.select(
			"id, user_id, name, default_env, is_builtin, source_path, thumbnail_url, thumbnail_updated_at, updated_at",
		)
		.or(orParts.join(","))
		.order("is_builtin", { ascending: true })
		.order("updated_at", { ascending: false });

	const templates: GalleryTemplate[] = ((data ?? []) as Array<{
		id: string;
		user_id: string | null;
		name: string;
		default_env: string | null;
		is_builtin: boolean;
		source_path: string | null;
		thumbnail_url: string | null;
		thumbnail_updated_at: string | null;
		updated_at: string | null;
	}>).map((t) => ({
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

	const backQs = new URLSearchParams();
	if (locationId) backQs.set("location_id", locationId);
	if (companyId) backQs.set("company_id", companyId);

	return (
		<div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
			<div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
				<div>
					<h1 style={{ fontSize: 22, fontWeight: 700, color: "#111", margin: 0 }}>ShotStack Templates</h1>
					<p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>
						Click any tile to preview, edit, clone, or delete. The visual editor
						captures a thumbnail automatically the first time you save.
					</p>
				</div>
				<Link
					href={`/ext/settings${backQs.toString() ? `?${backQs.toString()}` : ""}`}
					style={{ color: "#0969da", textDecoration: "underline", fontSize: 13 }}
				>
					← Back to settings
				</Link>
			</div>

			<ShotstackTemplateGalleryClient
				templates={templates}
				actions={{ templatesApiBase: "/api/ghl/shotstack-templates", templatesApiQuery }}
				editorUrlPrefix="/ext/shotstack/editor"
				allowCreate
			/>
		</div>
	);
}

const containerStyle: React.CSSProperties = {
	fontFamily: "system-ui, -apple-system, sans-serif",
	maxWidth: 640,
	margin: "40px auto",
	padding: 24,
	border: "1px solid #e1e4e8",
	borderRadius: 12,
	background: "#fff",
};
const titleStyle: React.CSSProperties = { fontSize: 20, fontWeight: 700, margin: 0, color: "#111" };
const bodyStyle: React.CSSProperties = { fontSize: 14, color: "#333", marginTop: 12 };
const linkBtnStyle: React.CSSProperties = {
	display: "inline-block",
	marginTop: 16,
	padding: "10px 18px",
	borderRadius: 8,
	background: "#2563eb",
	color: "#fff",
	fontSize: 14,
	fontWeight: 500,
	textDecoration: "none",
};
