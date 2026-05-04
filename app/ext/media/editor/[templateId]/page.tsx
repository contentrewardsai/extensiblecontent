import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { readWhopUserCookie, WHOP_USER_COOKIE } from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";
import type { MediaEditorContext } from "@/app/experiences/[experienceId]/media/media-editor-context";
import { OpenReelEditorHost } from "@/app/experiences/[experienceId]/media/editor/[templateId]/openreel-editor-host";

type SearchParams = { location_id?: string; locationId?: string; company_id?: string; companyId?: string };

export default async function GhlMediaEditorPage({
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
					Whop account first.
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
					href={`/ext/media${backQs.toString() ? `?${backQs.toString()}` : ""}`}
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
						Starter (save will clone)
					</span>
				) : null}
			</div>
			<OpenReelEditorHost
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
}): MediaEditorContext {
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
		editorUrlPrefix: "/ext/media/editor",
		backUrl: `/ext/media${backQs.toString() ? `?${backQs.toString()}` : ""}`,
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
