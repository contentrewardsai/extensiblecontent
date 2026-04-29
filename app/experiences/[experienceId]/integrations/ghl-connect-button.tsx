"use client";

/**
 * Opens HighLevel's OAuth location chooser so the Whop user can authorise
 * Extensible Content to access their HighLevel sub-account(s). Our backend
 * stores the tokens and links them to this Whop user — Extensible Content
 * sits in the middle holding credentials for both platforms.
 */
export function GhlConnectButton({ userId }: { userId: string }) {
	const handleConnect = () => {
		window.open(
			`/api/ghl/auth/start?userId=${encodeURIComponent(userId)}`,
			"_blank",
			"width=700,height=800",
		);
	};

	return (
		<button
			type="button"
			onClick={handleConnect}
			className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 shrink-0"
		>
			Connect GoHighLevel
		</button>
	);
}
