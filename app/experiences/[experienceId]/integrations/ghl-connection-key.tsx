"use client";

import { useState } from "react";
import { generateConnectionKey } from "./generate-key-action";

export function GhlConnectionKey({
	userId,
	existingKeyPrefix,
	existingKeyUsedAt,
}: {
	userId: string;
	existingKeyPrefix: string | null;
	existingKeyUsedAt: string | null;
}) {
	const [generatedKey, setGeneratedKey] = useState<string | null>(null);
	const [prefix, setPrefix] = useState(existingKeyPrefix);
	const [usedAt, setUsedAt] = useState(existingKeyUsedAt);
	const [loading, setLoading] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleGenerate = async () => {
		setLoading(true);
		try {
			const result = await generateConnectionKey(userId);
			if (result) {
				setGeneratedKey(result.key);
				setPrefix(result.prefix);
				setUsedAt(null);
			}
		} finally {
			setLoading(false);
		}
	};

	const handleCopy = async () => {
		if (!generatedKey) return;
		await navigator.clipboard.writeText(generatedKey);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="mt-4 border border-gray-a4 rounded-lg p-4 bg-gray-a1">
			<h4 className="text-3.5 font-semibold text-gray-12 mb-1">
				Connection Key
			</h4>
			<p className="text-2.5 text-gray-10 mb-3">
				Generate a key here, then paste it into GoHighLevel when installing the Extensible Content app.
			</p>

			{generatedKey ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<code className="flex-1 text-2.5 bg-gray-a3 border border-gray-a4 rounded px-3 py-2 text-gray-12 font-mono break-all select-all">
							{generatedKey}
						</code>
						<button
							type="button"
							onClick={handleCopy}
							className="shrink-0 text-2.5 font-medium px-3 py-2 rounded border border-gray-a4 bg-gray-a2 text-gray-12 hover:bg-gray-a3 transition-colors"
						>
							{copied ? "Copied!" : "Copy"}
						</button>
					</div>
					<p className="text-2 text-amber-10">
						Save this key now — it won&apos;t be shown again.
					</p>
				</div>
			) : prefix ? (
				<div className="flex items-center justify-between gap-2">
					<div>
						<p className="text-2.5 text-gray-11">
							Active key: <code className="font-mono text-gray-12">{prefix}•••</code>
						</p>
						{usedAt && (
							<p className="text-2 text-gray-10 mt-0.5">
								Last used: {new Date(usedAt).toLocaleDateString()}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={handleGenerate}
						disabled={loading}
						className="text-2.5 font-medium px-3 py-1.5 rounded border border-gray-a4 bg-gray-a2 text-gray-12 hover:bg-gray-a3 transition-colors disabled:opacity-50"
					>
						{loading ? "Generating..." : "Regenerate"}
					</button>
				</div>
			) : (
				<button
					type="button"
					onClick={handleGenerate}
					disabled={loading}
					className="text-3 font-medium px-4 py-2 rounded-md bg-blue-9 text-white hover:bg-blue-10 transition-colors disabled:opacity-50"
				>
					{loading ? "Generating..." : "Generate Connection Key"}
				</button>
			)}
		</div>
	);
}
