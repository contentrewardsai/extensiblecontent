/**
 * Tiny surface-agnostic wrappers around the ShotStack template API routes
 * used by the shared gallery. Pages construct a `TemplateActionsConfig`
 * (pointing at either /api/whop/... or /api/ghl/...) and get async handlers
 * that can be passed straight to `<ShotstackTemplateGallery />`.
 */
export interface TemplateActionsConfig {
	templatesApiBase: string;
	templatesApiQuery: string;
}

function buildUrl(cfg: TemplateActionsConfig, path: string): string {
	const url = `${cfg.templatesApiBase}${path}`;
	if (!cfg.templatesApiQuery) return url;
	return url.includes("?") ? `${url}&${cfg.templatesApiQuery}` : `${url}?${cfg.templatesApiQuery}`;
}

export async function cloneTemplateViaApi(cfg: TemplateActionsConfig, id: string): Promise<{ id: string }> {
	const res = await fetch(buildUrl(cfg, `/${id}/clone`), { method: "POST", credentials: "include" });
	if (!res.ok) {
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(j.error || `Clone failed (${res.status})`);
	}
	const body = (await res.json().catch(() => null)) as { id?: string } | null;
	if (!body?.id) throw new Error("Clone succeeded but server returned no id");
	return { id: body.id };
}

export async function deleteTemplateViaApi(cfg: TemplateActionsConfig, id: string): Promise<void> {
	const res = await fetch(buildUrl(cfg, `/${id}`), { method: "DELETE", credentials: "include" });
	if (!res.ok && res.status !== 204) {
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(j.error || `Delete failed (${res.status})`);
	}
}

export async function createBlankTemplateViaApi(
	cfg: TemplateActionsConfig,
	name = "Untitled template",
): Promise<{ id: string }> {
	const res = await fetch(buildUrl(cfg, ""), {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, edit: { timeline: { tracks: [] }, output: { format: "mp4" } } }),
	});
	if (!res.ok) {
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(j.error || `Create failed (${res.status})`);
	}
	const body = (await res.json().catch(() => null)) as { id?: string } | null;
	if (!body?.id) throw new Error("Create succeeded but server returned no id");
	return { id: body.id };
}
