import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const EXTENSION_CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function updateSession(request: NextRequest) {
	// Extension routes: no Supabase session needed; add CORS for API
	if (request.nextUrl.pathname.startsWith("/api/extension")) {
		if (request.method === "OPTIONS") {
			return new NextResponse(null, { status: 204, headers: EXTENSION_CORS_HEADERS });
		}
		const response = NextResponse.next({ request });
		for (const [k, v] of Object.entries(EXTENSION_CORS_HEADERS)) {
			response.headers.set(k, v);
		}
		return response;
	}
	// Extension login page: no Supabase session needed
	if (request.nextUrl.pathname.startsWith("/extension/")) {
		return NextResponse.next({ request });
	}

	const response = NextResponse.next({ request });

	try {
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
		if (!supabaseUrl || !supabaseAnonKey) return response;

		const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
		});
		await supabase.auth.getSession();
	} catch {
		// Session refresh failed; continue without session
	}

	return response;
}
