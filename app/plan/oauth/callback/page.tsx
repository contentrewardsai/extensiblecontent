"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Single registered OAuth redirect for the public /plan/<slug> pages.
 *
 * Whop validates `redirect_uri` against an allow-list, so we can't use
 * `/plan/<slug>` directly (would require one entry per plan). Instead we
 * register a single URI — `${origin}/plan/oauth/callback` — and stash
 * the originally requested plan path + PKCE bundle in sessionStorage
 * before kicking off OAuth in `plan-client.tsx`. This page completes the
 * token exchange, persists the access token to localStorage under the
 * shared `whop_plan_token` key, and redirects to the saved path.
 */

const TOKEN_STORAGE_KEY = "whop_plan_token";
const PKCE_STORAGE_KEY = "whop_plan_oauth_pkce";
const RETURN_PATH_KEY = "whop_plan_oauth_return";

interface StoredPkce {
	codeVerifier: string;
	state: string;
}

interface StoredToken {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	obtained_at: number;
}

export default function PlanOAuthCallbackPage() {
	const [status, setStatus] = useState<"loading" | "error">("loading");
	const [message, setMessage] = useState<string>("");
	// React 18 strict-mode in dev double-invokes effects; the OAuth code
	// is single-use, so we de-dupe via a ref.
	const ranRef = useRef(false);

	useEffect(() => {
		if (ranRef.current) return;
		ranRef.current = true;

		(async () => {
			const params = new URLSearchParams(window.location.search);
			const code = params.get("code");
			const returnedState = params.get("state");
			const oauthError = params.get("error");

			if (oauthError) {
				setStatus("error");
				setMessage(`${oauthError} – ${params.get("error_description") ?? ""}`);
				return;
			}
			if (!code || !returnedState) {
				setStatus("error");
				setMessage("Missing OAuth code or state on callback URL.");
				return;
			}

			const storedRaw = sessionStorage.getItem(PKCE_STORAGE_KEY);
			sessionStorage.removeItem(PKCE_STORAGE_KEY);
			const stored = storedRaw ? (JSON.parse(storedRaw) as StoredPkce) : null;
			if (!stored || returnedState !== stored.state) {
				setStatus("error");
				setMessage("Invalid OAuth state — please try again from the plan page.");
				return;
			}

			const returnPath = sessionStorage.getItem(RETURN_PATH_KEY) || "/";
			sessionStorage.removeItem(RETURN_PATH_KEY);
			// `redirect_uri` MUST match exactly what we sent to /authorize
			// (origin + this path, no query string).
			const redirectUri = `${window.location.origin}/plan/oauth/callback`;

			try {
				const res = await fetch("/api/extension/auth", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						code,
						code_verifier: stored.codeVerifier,
						redirect_uri: redirectUri,
					}),
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as { error?: string };
					throw new Error(body.error ?? `HTTP ${res.status}`);
				}
				const data = (await res.json()) as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
					user: { id: string; email?: string };
				};
				const token: StoredToken = {
					access_token: data.access_token,
					refresh_token: data.refresh_token,
					expires_in: data.expires_in,
					obtained_at: Date.now(),
				};
				localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
				// Belt-and-braces: only allow same-origin redirect targets.
				const safeReturn =
					returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
				window.location.replace(safeReturn);
			} catch (err) {
				setStatus("error");
				setMessage(err instanceof Error ? err.message : "Token exchange failed");
			}
		})();
	}, []);

	if (status === "loading") {
		return (
			<div className="min-h-screen bg-slate-50 flex items-center justify-center">
				<p className="text-slate-500 text-sm">Finishing sign-in…</p>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
			<div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-3">
				<h1 className="text-lg font-bold text-slate-800">Sign-in failed</h1>
				<p className="text-sm text-slate-600 break-words">{message}</p>
				<button
					type="button"
					onClick={() => window.history.back()}
					className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-lg px-4 py-2"
				>
					Go back
				</button>
			</div>
		</div>
	);
}
