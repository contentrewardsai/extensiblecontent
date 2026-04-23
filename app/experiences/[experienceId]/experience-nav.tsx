"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
	{ segment: "activity", label: "Activity" },
	{ segment: "following", label: "Following" },
	{ segment: "uploads", label: "Uploads" },
	{ segment: "shotstack", label: "ShotStack" },
	{ segment: "upload-post", label: "Upload Post" },
	{ segment: "integrations", label: "Integrations" },
] as const;

export function ExperienceNav({ experienceId }: { experienceId: string }) {
	const pathname = usePathname();
	const base = `/experiences/${experienceId}`;

	return (
		<nav className="flex flex-wrap gap-2 border-b border-gray-a4 pb-4 mb-6" aria-label="Experience sections">
			{LINKS.map(({ segment, label }) => {
				const href = `${base}/${segment}`;
				const active = pathname === href;
				return (
					<Link
						key={segment}
						href={href}
						className={`text-3 px-3 py-1.5 rounded-md transition-colors ${
							active ? "bg-gray-a4 text-gray-12 font-medium" : "text-gray-10 hover:bg-gray-a3 hover:text-gray-12"
						}`}
					>
						{label}
					</Link>
				);
			})}
		</nav>
	);
}
