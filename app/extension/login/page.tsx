"use client";

import { useCallback, useEffect, useState } from "react";
import { ExtensionUpgradeScreen } from "./upgrade-screen";

const STORAGE_KEY = "whop_oauth_pkce";
const MESSAGE_TYPE = "WHOP_AUTH_SUCCESS";

function base64url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) =>
		({ "+": "-", "/": "_", "=": "" })[c]!,
	);
}

function randomString(len: number) {
	return base64url(crypto.getRandomValues(new Uint8Array(len)));
}

async function sha256(str: string) {
	return base64url(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str))),
	);
}

export default function ExtensionLoginPage() {
	const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
	const [message, setMessage] = useState<string>("");
	const [userEmail, setUserEmail] = useState<string | undefined>();

	const startOAuth = useCallback(async () => {
		const clientId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
		if (!clientId) {
			setStatus("error");
			setMessage("Missing NEXT_PUBLIC_WHOP_APP_ID");
			return;
		}
		const redirectUri = `${window.location.origin}/extension/login`;
		const pkce = {
			codeVerifier: randomString(32),
			state: randomString(16),
			nonce: randomString(16),
		};
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pkce));
		const params = new URLSearchParams({
			response_type: "code",
			client_id: clientId,
			redirect_uri: redirectUri,
			scope: "openid profile email",
			state: pkce.state,
			nonce: pkce.nonce,
			code_challenge: await sha256(pkce.codeVerifier),
			code_challenge_method: "S256",
		});
		// Affiliate attribution: use URL param or default to contentrewardsai
		const affiliate = new URLSearchParams(window.location.search).get("a") ?? "contentrewardsai";
		params.set("a", affiliate);
		window.location.href = `https://api.whop.com/oauth/authorize?${params}`;
	}, []);

	const handleCallback = useCallback(async () => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		const returnedState = params.get("state");
		const error = params.get("error");
		if (error) {
			setStatus("error");
			setMessage(`OAuth error: ${error} - ${params.get("error_description") || ""}`);
			return;
		}
		if (!code || !returnedState) {
			setStatus("idle");
			return;
		}
		setStatus("loading");
		const storedRaw = sessionStorage.getItem(STORAGE_KEY);
		sessionStorage.removeItem(STORAGE_KEY);
		const stored = storedRaw ? (JSON.parse(storedRaw) as { codeVerifier: string; state: string }) : null;
		if (!stored || returnedState !== stored.state) {
			setStatus("error");
			setMessage("Invalid state - possible CSRF");
			return;
		}
		try {
			const redirectUri = `${window.location.origin}/extension/login`;
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
				const err = await res.json().catch(() => ({}));
				throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
			}
			const data = (await res.json()) as {
				access_token: string;
				refresh_token: string;
				expires_in: number;
				user: { id: string; email?: string };
			};
			const tokens = {
				access_token: data.access_token,
				refresh_token: data.refresh_token,
				expires_in: data.expires_in,
				obtained_at: Date.now(),
			};
			const payload = { type: MESSAGE_TYPE, tokens, user: data.user };
			window.postMessage(payload, "*");
			setUserEmail(data.user.email);
			setStatus("success");
			setMessage("Logged in! You can close this tab.");
		} catch (err) {
			setStatus("error");
			setMessage(err instanceof Error ? err.message : "Authentication failed");
		}
	}, []);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("code")) {
			handleCallback();
		}
	}, [handleCallback]);

	if (status === "loading") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-gray-50">
				<p className="text-gray-600">Completing sign in...</p>
			</div>
		);
	}
	if (status === "success") {
		return <ExtensionUpgradeScreen userEmail={userEmail} />;
	}
	if (status === "error") {
		const isOAuthConfig = message.toLowerCase().includes("oauth not configured");
		return (
			<div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-8">
				<p className="text-lg font-medium text-red-700">Sign in failed</p>
				<p className="text-sm text-gray-600">{message}</p>
				{message.includes("oauth:token_exchange") && (
					<p className="max-w-md text-xs text-gray-500 text-center">
						Whop Dashboard → your app → OAuth: switch to <strong>Public</strong> client mode, or enable <code>oauth:token_exchange</code> permission for the client secret.
					</p>
				)}
				{isOAuthConfig && !message.includes("oauth:token_exchange") && (
					<p className="max-w-md text-xs text-gray-500 text-center">
						Add NEXT_PUBLIC_WHOP_APP_ID and Supabase vars to your deployment (e.g. Vercel).
					</p>
				)}
				<button
					type="button"
					onClick={() => {
						setStatus("idle");
						setMessage("");
						window.history.replaceState({}, "", "/extension/login");
					}}
					className="rounded px-4 py-2 hover:opacity-90"
					style={{ backgroundColor: "#2563eb", color: "#ffffff" }}
				>
					Try again
				</button>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 p-8">
			<h1 className="text-xl font-semibold text-gray-900">Sign in with Whop</h1>
			<p className="text-sm text-gray-600">
				Sign in to connect the Extensible Content extension to your account.
			</p>
			<button
				type="button"
				onClick={startOAuth}
				className="rounded px-6 py-3 font-medium hover:opacity-90"
				style={{ backgroundColor: "#2563eb", color: "#ffffff" }}
			>
				Login with Whop
			</button>
		</div>
	);
}
