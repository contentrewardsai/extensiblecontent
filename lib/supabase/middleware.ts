import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const EXTENSION_CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function updateSession(request: NextRequest) {
	if (request.nextUrl.pathname.startsWith("/api/extension")) {
		if (request.method === "OPTIONS") {
			return new NextResponse(null, { status: 204, headers: EXTENSION_CORS_HEADERS });
		}
	}
	let response = NextResponse.next({ request });
	if (request.nextUrl.pathname.startsWith("/api/extension")) {
		for (const [k, v] of Object.entries(EXTENSION_CORS_HEADERS)) {
			response.headers.set(k, v);
		}
	}

	const supabase = createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return request.cookies.getAll();
				},
				setAll(cookiesToSet) {
					cookiesToSet.forEach(({ name, value, options }) =>
						response.cookies.set(name, value, options),
					);
				},
			},
		},
	);

	// Refreshes session if expired
	await supabase.auth.getSession();

	return response;
}
