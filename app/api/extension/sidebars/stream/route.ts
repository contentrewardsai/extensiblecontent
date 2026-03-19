import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const channelName = `user:${user.user_id}`;

	let channelRef: ReturnType<typeof supabase.channel> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const sendEvent = (data: object) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Stream may be closed
				}
			};

			const channel = supabase
				.channel(channelName)
				.on("broadcast", { event: "list_updated" }, () => {
					sendEvent({ type: "list_updated" });
				})
				.subscribe((status) => {
					if (status === "SUBSCRIBED") {
						sendEvent({ type: "connected" });
					}
				});

			channelRef = channel;

			request.signal.addEventListener("abort", () => {
				if (channelRef) {
					supabase.removeChannel(channelRef);
					channelRef = null;
				}
				try {
					controller.close();
				} catch {
					// Already closed
				}
			});
		},
		cancel() {
			if (channelRef) {
				supabase.removeChannel(channelRef);
				channelRef = null;
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
