/**
 * Hostname matching for the workflows catalog domain filter.
 *
 * The extension's "Suggest fallbacks" flow passes ?hostname=labs.google (or
 * ?origin=https://labs.google) and expects only workflows whose
 * workflow.urlPattern.origin (or first run/action URL) match that host or any
 * subdomain of it. Mirrors the extension's own urlMatchesPattern semantics.
 */

export function normalizeHostname(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const trimmed = String(raw).trim().toLowerCase();
	if (!trimmed) return null;
	return trimmed.replace(/^www\./, "");
}

export function hostnameFromOrigin(origin: string | null | undefined): string | null {
	if (!origin) return null;
	try {
		return normalizeHostname(new URL(String(origin)).hostname);
	} catch {
		return null;
	}
}

/**
 * Resolve the candidate hostname for a stored workflow row by looking at common
 * fields the extension writes into the opaque workflow JSON blob.
 */
export function workflowCandidateHostname(workflow: unknown): string | null {
	if (!workflow || typeof workflow !== "object") return null;
	const w = workflow as Record<string, unknown>;

	const urlPattern = w.urlPattern as Record<string, unknown> | undefined;
	const patternOrigin = urlPattern && typeof urlPattern.origin === "string" ? urlPattern.origin : null;
	const patternHostname = urlPattern && typeof urlPattern.hostname === "string" ? urlPattern.hostname : null;
	if (patternHostname) {
		const h = normalizeHostname(patternHostname);
		if (h) return h;
	}
	if (patternOrigin) {
		const h = hostnameFromOrigin(patternOrigin);
		if (h) return h;
	}

	const runs = Array.isArray(w.runs) ? (w.runs as Array<Record<string, unknown>>) : null;
	const firstRunUrl = runs && runs.length > 0 && typeof runs[0]?.url === "string" ? (runs[0].url as string) : null;
	if (firstRunUrl) {
		const h = hostnameFromOrigin(firstRunUrl);
		if (h) return h;
	}

	const analyzed = w.analyzed as Record<string, unknown> | undefined;
	const actions = analyzed && Array.isArray(analyzed.actions) ? (analyzed.actions as Array<Record<string, unknown>>) : null;
	const firstActionUrl = actions && actions.length > 0 && typeof actions[0]?.url === "string" ? (actions[0].url as string) : null;
	if (firstActionUrl) {
		const h = hostnameFromOrigin(firstActionUrl);
		if (h) return h;
	}

	return null;
}

/** Exact match or subdomain match against a normalized target hostname. */
export function hostnameMatches(candidate: string | null, target: string | null): boolean {
	if (!candidate || !target) return false;
	if (candidate === target) return true;
	return candidate.endsWith(`.${target}`);
}

export function workflowMatchesHostname(workflow: unknown, target: string | null): boolean {
	if (!target) return true;
	return hostnameMatches(workflowCandidateHostname(workflow), target);
}
