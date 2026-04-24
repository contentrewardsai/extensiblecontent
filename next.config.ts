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
	],
};

export default withWhopAppConfig(nextConfig);
