import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { readWhopUserCookie, WHOP_USER_COOKIE } from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";
import type { ShotstackEditorContext } from "@/app/experiences/[experienceId]/shotstack/shotstack-editor-context";
import { ShotstackEditorHost } from "@/app/experiences/[experienceId]/shotstack/shotstack-editor-host";

type SearchParams = { location_id?: string; locationId?: string; company_id?: string; companyId?: string };

/**
 * GHL-authenticated ShotStack editor.
 *
 * Access model:
 *   - The GHL Custom Page sets the `ec_whop_user` cookie via the OAuth / picker
 *     flow in `/ext/settings`. This page reads that cookie to identify the
 *     Whop user.
 *   - Visibility rules (user-owned / project-shared / built-in) are the same
 *     as the Whop experience editor; built-ins are opened read-only and the
 *     host performs an implicit clone on save.
 *
 * If no cookie is present we bounce the user back to `/ext/settings` so they
 * can link / pick a Whop account first. The GHL `location_id` / `company_id`
 * (if provided via the URL) are forwarded so the cookie's GHL linkage can be
 * re-verified on each API request.
 */
export default async function GhlShotstackEditorPage({
	params,
	searchParams,
}: {
	params: Promise<{ templateId: string }>;
	searchParams: Promise<SearchParams>;
}) {
	const { templateId } = await params;
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
			<div style={containerStyle}>
				<h1 style={titleStyle}>Link your Whop account to edit templates</h1>
				<p style={bodyStyle}>
					We couldn&apos;t find a linked Whop account for this browser session. Open
					the <strong>Extensible Content</strong> settings page and connect your
					Whop account first; you&apos;ll then be able to open any of your
					templates in the visual editor right here.
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
	if (memberProjectIds.length > 0) {
		orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	}
	const { data: row, error } = await supabase
		.from("shotstack_templates")
		.select("id, name, edit, default_env, is_builtin, user_id")
		.eq("id", templateId)
		.or(orParts.join(","))
		.maybeSingle();
	if (error || !row?.edit || typeof row.edit !== "object") {
		notFound();
	}

	const context = buildGhlEditorContext({ locationId, companyId });
	const backQs = new URLSearchParams();
	if (locationId) backQs.set("location_id", locationId);
	if (companyId) backQs.set("company_id", companyId);

	return (
		<div style={{ maxWidth: 1280, margin: "0 auto", padding: "16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
				<Link
					href={`/ext/shotstack${backQs.toString() ? `?${backQs.toString()}` : ""}`}
					style={{ color: "#0969da", textDecoration: "underline", fontSize: 13 }}
				>
					← Back to templates
				</Link>
				<span style={{ color: "#999", fontSize: 13 }}>|</span>
				<span style={{ color: "#111", fontWeight: 500, fontSize: 13 }}>{row.name}</span>
				{row.is_builtin ? (
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							padding: "1px 8px",
							borderRadius: 10,
							border: "1px solid #d0d5dd",
							fontSize: 12,
							color: "#444",
						}}
					>
						Starter · read-only (save will clone)
					</span>
				) : null}
			</div>
			<ShotstackEditorHost
				templateId={row.id}
				templateName={row.name}
				isBuiltin={!!row.is_builtin}
				initialEdit={row.edit as Record<string, unknown>}
				context={context}
			/>
		</div>
	);
}

function buildGhlEditorContext({
	locationId,
	companyId,
}: {
	locationId: string;
	companyId: string;
}): ShotstackEditorContext {
	const qsParts: string[] = [];
	if (locationId) qsParts.push(`locationId=${encodeURIComponent(locationId)}`);
	if (companyId) qsParts.push(`companyId=${encodeURIComponent(companyId)}`);
	const query = qsParts.join("&");
	const browserRenderFields: Record<string, string> = {};
	if (locationId) browserRenderFields.locationId = locationId;
	if (companyId) browserRenderFields.companyId = companyId;
	const backQs = new URLSearchParams();
	if (locationId) backQs.set("location_id", locationId);
	if (companyId) backQs.set("company_id", companyId);
	return {
		templatesApiBase: "/api/ghl/shotstack-templates",
		templatesApiQuery: query,
		browserRenderUrl: "/api/ghl/shotstack/browser-render",
		browserRenderFields,
		editorUrlPrefix: "/ext/shotstack/editor",
		backUrl: `/ext/shotstack${backQs.toString() ? `?${backQs.toString()}` : ""}`,
		thumbnailUploadUrl: "/api/ghl/shotstack-templates/:id/thumbnail",
		imageUploadUrl: "/api/ghl/shotstack-templates/upload-image",
		videoUploadUrl: "/api/ghl/shotstack-templates/upload-video",
		presignedUploadUrl: "/api/ghl/shotstack/presigned-upload",
		confirmUploadUrl: "/api/ghl/shotstack/confirm-upload",
	};
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
