import { withWhopAppConfig } from "@whop/react/next.config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	transpilePackages: ["@openreel/core", "@openreel/ui"],
	webpack: (config) => {
		config.module.rules.push({
			test: /\.wasm$/,
			type: "asset/resource",
		});
		return config;
	},
	images: {
		remotePatterns: [{ hostname: "**" }],
	},
	// The single-threaded FFmpeg WASM core and Kokoro TTS (with numThreads=1)
	// do NOT require SharedArrayBuffer. COOP/COEP headers were previously set
	// on these routes to enable crossOriginIsolated, but that actually BROKE
	// Worker loading inside GHL/Whop iframes (Chrome fires a sparse error
	// event with all fields undefined when COEP credentialless blocks
	// `new Worker(url)`). Removed so Workers load natively in any context;
	// the Blob-URL fallback in ffmpeg-local.js still works as a safety net.
	headers: async () => [
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
		{
			// Generator/editor JS files change frequently during development.
			// Prevent Vercel CDN from serving stale cached copies.
			source: "/generator/:path*",
			headers: [
				{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
			],
		},
		{
			source: "/shared/:path*",
			headers: [
				{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
			],
		},
	],
	redirects: async () => [
		{
			source: "/experiences/:experienceId/shotstack",
			destination: "/experiences/:experienceId/media",
			permanent: true,
		},
		{
			source: "/experiences/:experienceId/shotstack/:path*",
			destination: "/experiences/:experienceId/media/:path*",
			permanent: true,
		},
		{
			source: "/ext/shotstack/:path*",
			destination: "/ext/media/:path*",
			permanent: true,
		},
	],
	rewrites: async () => [
		{
			// Keeps every public `/api/ext-auth/...` URL neutral (HighLevel
			// rejects apps that expose `ghl` in any URL they can see). All
			// Custom Auth endpoints — authorize, token, refresh, test, userinfo
			// — live behind this single rewrite.
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
