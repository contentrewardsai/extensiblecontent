import { WhopApp } from "@whop/react/components";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
	const host =
		(await headers())
			.get("host")
			?.replace(/:\d+$/, "")
			.toLowerCase() ?? "";

	if (host.includes("contentrewardsai.com")) {
		return {
			title: "Content Rewards AI - Scale Your Clipping Campaigns",
			description:
				"Automate clipping campaigns, track views, handle payouts instantly.",
		};
	}

	return {
		title: "Extensible Content — Extension demo",
		description:
			"Chrome extension demo — side panel + workflow on a stock-photo style page",
	};
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<WhopApp>{children}</WhopApp>
			</body>
		</html>
	);
}
