import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { ghlFetch } from "@/lib/ghl";

/**
 * GET /api/extension/ghl/media?locationId=...
 *
 * Proxies GHL GET /medias/files to list media files/folders.
 * Query params forwarded: sortBy, sortOrder, limit, offset, type
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { searchParams } = request.nextUrl;
	const locationId = searchParams.get("locationId");
	if (!locationId) {
		return Response.json({ error: "locationId is required" }, { status: 400 });
	}

	const ghlParams = new URLSearchParams({
		altId: locationId,
		altType: "location",
	});

	for (const key of ["sortBy", "sortOrder", "limit", "offset", "type"]) {
		const val = searchParams.get(key);
		if (val) ghlParams.set(key, val);
	}

	try {
		const res = await ghlFetch(
			user.user_id,
			locationId,
			`/medias/files?${ghlParams}`,
		);

		const data = await res.json();
		if (!res.ok) {
			return Response.json(
				{ error: "GHL API error", details: data },
				{ status: res.status },
			);
		}
		return Response.json(data);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}

/**
 * DELETE /api/extension/ghl/media?locationId=...&fileId=...
 *
 * Proxies GHL DELETE /medias/:fileId
 */
export async function DELETE(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { searchParams } = request.nextUrl;
	const locationId = searchParams.get("locationId");
	const fileId = searchParams.get("fileId");
	if (!locationId || !fileId) {
		return Response.json(
			{ error: "locationId and fileId are required" },
			{ status: 400 },
		);
	}

	try {
		const res = await ghlFetch(
			user.user_id,
			locationId,
			`/medias/${encodeURIComponent(fileId)}?altId=${locationId}&altType=location`,
			{ method: "DELETE" },
		);

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			return Response.json(
				{ error: "GHL API error", details: data },
				{ status: res.status },
			);
		}
		return Response.json({ ok: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}
