import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side media proxy to bypass CORS restrictions.
 * The browser can't fetch audio/video from external servers that don't
 * send Access-Control-Allow-Origin headers. This route fetches the URL
 * on the server and streams it back to the browser from the same origin.
 *
 * Usage: GET /api/media-proxy?url=https://example.com/audio.mp3
 */

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB limit
const TIMEOUT_MS = 30_000;

const ALLOWED_CONTENT_TYPES = new Set([
	"audio/mpeg",
	"audio/mp3",
	"audio/mp4",
	"audio/m4a",
	"audio/wav",
	"audio/wave",
	"audio/x-wav",
	"audio/ogg",
	"audio/webm",
	"audio/aac",
	"audio/flac",
	"audio/x-flac",
	"video/mp4",
	"video/webm",
	"video/ogg",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"application/octet-stream", // some CDNs use this for audio
]);

export async function GET(req: NextRequest) {
	const url = req.nextUrl.searchParams.get("url");
	if (!url) {
		return NextResponse.json({ error: "Missing ?url= parameter" }, { status: 400 });
	}

	// Basic validation
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
	}
	if (!["http:", "https:"].includes(parsed.protocol)) {
		return NextResponse.json({ error: "Only http/https URLs allowed" }, { status: 400 });
	}

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

		const upstream = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "ExtensibleContentApp/1.0 MediaProxy",
			},
		});
		clearTimeout(timeout);

		if (!upstream.ok) {
			return NextResponse.json(
				{ error: `Upstream returned ${upstream.status}` },
				{ status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
			);
		}

		// Check content type
		const contentType = (upstream.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
		if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
			return NextResponse.json(
				{ error: `Content type not allowed: ${contentType}` },
				{ status: 415 },
			);
		}

		// Check size
		const contentLength = upstream.headers.get("content-length");
		if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
			return NextResponse.json(
				{ error: `File too large (${contentLength} bytes, max ${MAX_SIZE_BYTES})` },
				{ status: 413 },
			);
		}

		const body = upstream.body;
		if (!body) {
			return NextResponse.json({ error: "No response body" }, { status: 502 });
		}

		return new NextResponse(body, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				...(contentLength ? { "Content-Length": contentLength } : {}),
				"Cache-Control": "public, max-age=3600, s-maxage=86400",
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("abort")) {
			return NextResponse.json({ error: "Upstream request timed out" }, { status: 504 });
		}
		return NextResponse.json({ error: `Proxy error: ${msg}` }, { status: 502 });
	}
}
