import type { NextRequest } from "next/server";
import { headFromListResponse, sidebarsListResponse } from "./list-handler";

export async function GET(request: NextRequest) {
	try {
		return await sidebarsListResponse(request);
	} catch (err) {
		console.error("[sidebars] Unexpected error:", err);
		return Response.json({ error: "Failed to list sidebars" }, { status: 500 });
	}
}

export async function HEAD(request: NextRequest) {
	try {
		const res = await sidebarsListResponse(request);
		return headFromListResponse(res);
	} catch (err) {
		console.error("[sidebars] HEAD unexpected error:", err);
		return new Response(null, { status: 500 });
	}
}
