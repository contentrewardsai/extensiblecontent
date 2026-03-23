/**
 * Normalize user-provided origin / hostname / domain for knowledge_questions.site_domain.
 * Lowercases host and strips a leading "www." so lookups align across common URL shapes.
 */
export function normalizeSiteDomain(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;
	let host: string;
	try {
		const withScheme = s.includes("://") ? s : `https://${s}`;
		const u = new URL(withScheme);
		host = u.hostname;
	} catch {
		return null;
	}
	host = host.toLowerCase();
	if (host.startsWith("www.")) host = host.slice(4);
	return host || null;
}

/** Resolve site domain from API input: exactly one of origin | hostname | domain (non-empty string). */
export function siteDomainFromBody(input: {
	origin?: string;
	hostname?: string;
	domain?: string;
}): { ok: true; site_domain: string } | { ok: false; error: string } {
	const origin = typeof input.origin === "string" ? input.origin.trim() : "";
	const hostname = typeof input.hostname === "string" ? input.hostname.trim() : "";
	const domain = typeof input.domain === "string" ? input.domain.trim() : "";
	const provided = [origin, hostname, domain].filter(Boolean);
	if (provided.length === 0) {
		return { ok: false, error: "One of origin, hostname, or domain is required" };
	}
	if (provided.length > 1) {
		return { ok: false, error: "Provide only one of origin, hostname, or domain" };
	}
	const raw = origin || hostname || domain;
	const site_domain = normalizeSiteDomain(raw);
	if (!site_domain) {
		return { ok: false, error: "Invalid origin, hostname, or domain" };
	}
	return { ok: true, site_domain };
}

/** Read site domain from GET query: exactly one of origin | hostname | domain. */
export function siteDomainFromSearchParams(searchParams: URLSearchParams): { ok: true; site_domain: string } | { ok: false; error: string } {
	const origin = searchParams.get("origin")?.trim() ?? "";
	const hostname = searchParams.get("hostname")?.trim() ?? "";
	const domain = searchParams.get("domain")?.trim() ?? "";
	const provided = [origin, hostname, domain].filter(Boolean);
	if (provided.length === 0) {
		return { ok: false, error: "One of origin, hostname, or domain query param is required" };
	}
	if (provided.length > 1) {
		return { ok: false, error: "Provide only one of origin, hostname, or domain" };
	}
	const raw = origin || hostname || domain;
	const site_domain = normalizeSiteDomain(raw);
	if (!site_domain) {
		return { ok: false, error: "Invalid origin, hostname, or domain" };
	}
	return { ok: true, site_domain };
}
