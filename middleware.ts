import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function getHost(request: NextRequest): string {
	return (
		request.headers.get("host")?.replace(/:\d+$/, "").toLowerCase() ?? ""
	);
}

function isContentRewardsDomain(host: string): boolean {
	return (
		host.includes("contentrewardsai.com") ||
		host.includes("contentrewardsapp.com")
	);
}

export async function middleware(request: NextRequest) {
	const { pathname, searchParams } = request.nextUrl;
	const host = getHost(request);

	const isCRA =
		isContentRewardsDomain(host) ||
		(process.env.NODE_ENV === "development" &&
			searchParams.get("site") === "content-rewards-ai");

	if (pathname === "/" && isCRA) {
		return NextResponse.rewrite(
			new URL("/content-rewards-ai", request.url),
		);
	}

	return updateSession(request);
}

export const config = {
	matcher: [
		/*
		 * Match all request paths except for the ones starting with:
		 * - _next/static (static files)
		 * - _next/image (image optimization files)
		 * - favicon.ico (favicon file)
		 */
		"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
};
