import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getValidTokenForLocation } from "@/lib/ghl";

const GHL_API_BASE =
	process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";

/**
 * POST /api/extension/ghl/media/upload
 *
 * Proxies GHL POST /medias/upload-file.
 * Accepts either:
 *   - multipart/form-data with `file`, `locationId`, and optional `name`
 *   - JSON body with `fileUrl`, `locationId`, `name` (hosted upload)
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const contentType = request.headers.get("content-type") || "";

	if (contentType.includes("multipart/form-data")) {
		return handleMultipartUpload(request, user.user_id);
	}
	return handleHostedUpload(request, user.user_id);
}

async function handleMultipartUpload(request: NextRequest, userId: string) {
	const formData = await request.formData();
	const locationId = formData.get("locationId") as string;
	if (!locationId) {
		return Response.json({ error: "locationId is required" }, { status: 400 });
	}

	const { token } = await getValidTokenForLocation(userId, locationId);

	// Forward the form data to GHL
	const ghlForm = new FormData();
	const file = formData.get("file");
	if (!file) {
		return Response.json({ error: "file is required" }, { status: 400 });
	}
	ghlForm.append("file", file);
	ghlForm.append("hosted", "false");

	const name = formData.get("name");
	if (name) ghlForm.append("name", name as string);

	try {
		const res = await fetch(`${GHL_API_BASE}/medias/upload-file`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Version: "2021-07-28",
				Accept: "application/json",
			},
			body: ghlForm,
		});

		const data = await res.json();
		if (!res.ok) {
			return Response.json(
				{ error: "GHL upload error", details: data },
				{ status: res.status },
			);
		}
		return Response.json(data);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}

async function handleHostedUpload(request: NextRequest, userId: string) {
	let body: { locationId: string; fileUrl: string; name?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { locationId, fileUrl, name } = body;
	if (!locationId || !fileUrl) {
		return Response.json(
			{ error: "locationId and fileUrl are required" },
			{ status: 400 },
		);
	}

	const { token } = await getValidTokenForLocation(userId, locationId);

	const ghlBody: Record<string, string> = {
		fileUrl,
		hosted: "true",
	};
	if (name) ghlBody.name = name;

	try {
		const res = await fetch(`${GHL_API_BASE}/medias/upload-file`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Version: "2021-07-28",
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(ghlBody),
		});

		const data = await res.json();
		if (!res.ok) {
			return Response.json(
				{ error: "GHL upload error", details: data },
				{ status: res.status },
			);
		}
		return Response.json(data);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}
