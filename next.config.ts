import { withWhopAppConfig } from "@whop/react/next.config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	images: {
		remotePatterns: [{ hostname: "**" }],
	},
	// FFmpeg.wasm (synced to public/lib/ffmpeg) uses SharedArrayBuffer only on the pages that
	// actually run the in-browser render pipeline. We scope COOP/COEP to just those routes so
	// the Whop iframe / third-party SDKs on the rest of the app are unaffected.
	//
	// We use `credentialless` for COEP so cross-origin subresources without CORP headers still
	// load (they just load without credentials). This keeps Whop auth iframes and other
	// third-party scripts working on the shotstack pages that need SharedArrayBuffer.
	headers: async () => [
		{
			source: "/experiences/:experienceId/shotstack",
			headers: [
				{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
				{ key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
			],
		},
		{
			source: "/experiences/:experienceId/shotstack/editor/:templateId",
			headers: [
				{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
				{ key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
			],
		},
		{
			source: "/ext/shotstack/editor/:templateId",
			headers: [
				{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
				{ key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
			],
		},
		{
			source: "/ext/shotstack/:path*",
			headers: [
				{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
				{ key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
			],
		},
		{
			source: "/lib/ffmpeg/:file*",
			headers: [
				{ key: "Cache-Control", value: "public, max-age=31536000, immutable" },
				{ key: "Cross-Origin-Resource-Policy", value: "same-origin" },
			],
		},
		{
			source: "/lib/kokoro/:file*",
			headers: [
				{ key: "Cache-Control", value: "public, max-age=31536000, immutable" },
				{ key: "Cross-Origin-Resource-Policy", value: "same-origin" },
			],
		},
		{
			source: "/lib/transformers/:file*",
			headers: [
				{ key: "Cache-Control", value: "public, max-age=31536000, immutable" },
				{ key: "Cross-Origin-Resource-Policy", value: "same-origin" },
			],
		},
		{
			source: "/cfs-web/:file*",
			headers: [
				{ key: "Cache-Control", value: "public, max-age=3600" },
				{ key: "Cross-Origin-Resource-Policy", value: "same-origin" },
			],
		},
	],
	rewrites: async () => [
		{
			// Keeps every public `/api/ext-auth/...` URL neutral (HighLevel
			// rejects apps that expose `ghl` in any URL they can see, including
			// the redirect_uri we give to Whop during the Custom Auth flow which
			// briefly shows in the user's address bar). All Custom Auth endpoints
			// — authorize, token, refresh, test, userinfo, whop-callback — live
			// behind this single rewrite.
			source: "/api/ext-auth/:path*",
			destination: "/api/ghl/external-auth/:path*",
		},
		{
			source: "/api/ext-sso",
			destination: "/api/ghl/sso",
		},
		{
			source: "/api/ext-hooks",
			destination: "/api/ghl/webhooks",
		},
		{
			source: "/api/ext-callback",
			destination: "/api/ghl/auth/callback",
		},
		{
			source: "/api/ext-connect/:path*",
			destination: "/api/ghl/auth/:path*",
		},
	],
};

export default withWhopAppConfig(nextConfig);
