import type { NextRequest } from "next/server";
import { sidebarsListGetResponse, sidebarsListHeadResponse } from "./list-handler";

export async function GET(request: NextRequest) {
	try {
		return await sidebarsListGetResponse(request);
	} catch (err) {
		console.error("[sidebars] Unexpected error:", err);
		return Response.json({ error: "Failed to list sidebars" }, { status: 500 });
	}
}

export async function HEAD(request: NextRequest) {
	try {
		return await sidebarsListHeadResponse(request);
	} catch (err) {
		console.error("[sidebars] HEAD unexpected error:", err);
		return new Response(null, { status: 500 });
	}
}
