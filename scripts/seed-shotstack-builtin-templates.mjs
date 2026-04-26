#!/usr/bin/env node
/**
 * Seed the 7 built-in generator templates into `shotstack_templates`.
 *
 * Fetches `generator/templates/<slug>/template.json` from the
 * `contentrewardsai/ExtensibleContentExtension` repo (at a pinned commit) and
 * upserts a row per slug with `is_builtin = true, user_id = null` so every
 * authenticated extension user sees the same starter library.
 *
 * Safe to re-run; upsert is keyed on `source_path`.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   EXTENSION_TEMPLATES_REF   Commit SHA / branch / tag to fetch from (default: pinned SHA below)
 *
 * Usage:
 *   pnpm seed:shotstack-builtins
 *   EXTENSION_TEMPLATES_REF=main pnpm seed:shotstack-builtins
 */

import { createClient } from "@supabase/supabase-js";

// Pinned so reseeds are reproducible. Bump when the extension ships new
// built-ins; the upsert is idempotent on `source_path`.
const DEFAULT_REF = "03292705b91d7ae9984f274a28f11cc503775ac8";
const REPO = "contentrewardsai/ExtensibleContentExtension";
const REF = process.env.EXTENSION_TEMPLATES_REF || DEFAULT_REF;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${REF}/generator/templates`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
	console.error("[seed] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
	console.error("[seed] Run via `pnpm dotenv -e .env.local -- pnpm seed:shotstack-builtins` if using Next.js env files.");
	process.exit(1);
}

async function fetchJson(url) {
	const res = await fetch(url, {
		headers: { Accept: "application/json, */*" },
	});
	if (!res.ok) {
		throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
	}
	return res.json();
}

/** Pull a string replace value out of the ShotStack merge array. */
function readMerge(edit, key) {
	const merge = edit?.merge;
	if (!Array.isArray(merge)) return null;
	for (const entry of merge) {
		if (entry && typeof entry === "object" && entry.find === key) {
			return typeof entry.replace === "string" ? entry.replace : null;
		}
	}
	return null;
}

/** Human-readable name: "Ad Apple Notes" from "ad-apple-notes". */
function slugToName(slug) {
	return slug
		.split("-")
		.map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
		.join(" ");
}

async function main() {
	console.log(`[seed] Using ${REPO}@${REF}`);

	const manifest = await fetchJson(`${RAW_BASE}/manifest.json`);
	const slugs = Array.isArray(manifest?.templates) ? manifest.templates : [];
	if (slugs.length === 0) {
		throw new Error("manifest.json has no templates");
	}
	console.log(`[seed] Manifest lists ${slugs.length} templates: ${slugs.join(", ")}`);

	const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	let upserted = 0;
	for (const slug of slugs) {
		const url = `${RAW_BASE}/${slug}/template.json`;
		let edit;
		try {
			edit = await fetchJson(url);
		} catch (err) {
			console.error(`[seed] Skipping ${slug}: ${err.message}`);
			continue;
		}

		const name = readMerge(edit, "__CFS_TEMPLATE_NAME") || slugToName(slug);
		const now = new Date().toISOString();

		// The unique index on source_path is partial (WHERE is_builtin = true),
		// which a plain ON CONFLICT clause can't target. Do an explicit
		// find-then-update-or-insert keyed on (source_path, is_builtin=true).
		const { data: existing, error: findErr } = await supabase
			.from("shotstack_templates")
			.select("id")
			.eq("source_path", slug)
			.eq("is_builtin", true)
			.maybeSingle();

		if (findErr) {
			console.error(`[seed] Lookup failed for ${slug}: ${findErr.message}`);
			continue;
		}

		if (existing?.id) {
			const { error } = await supabase
				.from("shotstack_templates")
				.update({ name, edit, default_env: "v1", updated_at: now })
				.eq("id", existing.id);
			if (error) {
				console.error(`[seed] Update failed for ${slug}: ${error.message}`);
				continue;
			}
			console.log(`[seed] ↻ ${slug} → "${name}" (updated)`);
		} else {
			const { error } = await supabase.from("shotstack_templates").insert({
				is_builtin: true,
				user_id: null,
				project_id: null,
				source_path: slug,
				name,
				edit,
				default_env: "v1",
				updated_at: now,
			});
			if (error) {
				console.error(`[seed] Insert failed for ${slug}: ${error.message}`);
				continue;
			}
			console.log(`[seed] ✔ ${slug} → "${name}" (inserted)`);
		}
		upserted += 1;
	}

	console.log(`[seed] Done. Upserted ${upserted}/${slugs.length} built-in templates.`);
	if (upserted !== slugs.length) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("[seed] Fatal:", err);
	process.exit(1);
});
