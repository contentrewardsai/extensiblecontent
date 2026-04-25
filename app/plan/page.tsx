import type { Metadata } from "next";
import { headers } from "next/headers";
import "./plan.css";
import { PlanIndexClient } from "./plan-index-client";

async function getBrandName(): Promise<string> {
	const host =
		(await headers())
			.get("host")
			?.replace(/:\d+$/, "")
			.toLowerCase() ?? "";
	return host.includes("contentrewardsai.com") ||
		host.includes("contentrewardsapp.com")
		? "Content Rewards AI"
		: "Extensible Content";
}

export async function generateMetadata(): Promise<Metadata> {
	const brand = await getBrandName();
	return {
		title: `${brand} - Create a Promotion Plan`,
		description: `Enter a slug to create or open a shareable promotion plan on ${brand}.`,
	};
}

export default async function PlanIndexPage() {
	const brand = await getBrandName();
	return <PlanIndexClient brand={brand} />;
}
