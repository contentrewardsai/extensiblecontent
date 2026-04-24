import { withWhopAppConfig } from "@whop/react/next.config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	images: {
		remotePatterns: [{ hostname: "**" }],
	},
	rewrites: async () => [
		{
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
			source: "/api/ext-validate",
			destination: "/api/ghl/external-auth/validate",
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
