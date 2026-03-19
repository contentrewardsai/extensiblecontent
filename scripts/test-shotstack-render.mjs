#!/usr/bin/env node
/**
 * Test script: submit Summer Holiday template to ShotStack staging.
 *
 * Option A - Backend (no extension token needed):
 *   curl -X POST -H "X-Test-Secret: $SHOTSTACK_TEST_SECRET" \
 *     "https://your-app.vercel.app/api/shotstack/test-render?wait=true"
 *
 * Option B - With extension token (local):
 *   SHOTSTACK_TEST_TOKEN=<whop_access_token> node scripts/test-shotstack-render.mjs
 *   SHOTSTACK_TEST_TOKEN=<token> node scripts/test-shotstack-render.mjs --poll
 *
 * Get the token from the Chrome extension (chrome.storage.local.whop_auth.access_token).
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.APP_ORIGIN || "http://localhost:3000";
const TOKEN = process.env.SHOTSTACK_TEST_TOKEN;
const POLL = process.argv.includes("--poll");

if (!TOKEN) {
	console.error("Error: SHOTSTACK_TEST_TOKEN is required.");
	console.error("Get the token from the Chrome extension after logging in.");
	console.error("Usage: SHOTSTACK_TEST_TOKEN=<token> node scripts/test-shotstack-render.mjs [--poll]");
	process.exit(1);
}

const templatePath = join(__dirname, "summer-holiday-template.json");
const edit = JSON.parse(readFileSync(templatePath, "utf-8"));

async function submit() {
	const res = await fetch(`${BASE_URL}/api/extension/shotstack/render`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${TOKEN}`,
		},
		body: JSON.stringify({
			edit,
			duration_seconds: 20,
			env: "stage",
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Render failed: ${res.status} ${err}`);
	}

	return res.json();
}

async function getStatus(id) {
	const res = await fetch(`${BASE_URL}/api/extension/shotstack/status/${id}?env=stage`, {
		headers: { Authorization: `Bearer ${TOKEN}` },
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Status failed: ${res.status} ${err}`);
	}

	return res.json();
}

async function main() {
	console.log("Submitting Summer Holiday template to ShotStack staging...");
	const result = await submit();
	console.log("Submitted:", result.id, "Status:", result.status);

	if (!POLL) {
		console.log("\nDone. Use --poll to wait for completion:");
		console.log(`  SHOTSTACK_TEST_TOKEN=<token> node scripts/test-shotstack-render.mjs --poll`);
		return;
	}

	console.log("\nPolling for completion...");
	let status = result;
	while (status.status !== "done" && status.status !== "failed") {
		await new Promise((r) => setTimeout(r, 3000));
		status = await getStatus(result.id);
		console.log("  Status:", status.status);
	}

	if (status.status === "done" && status.url) {
		console.log("\nRender complete!");
		console.log("Output URL:", status.url);
	} else if (status.status === "failed") {
		console.error("\nRender failed:", status.error || "Unknown error");
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
