"use client";

import { useEffect, useState } from "react";

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

export function parseBirthday(value: string | null | undefined): { month: string; day: string; year: string } {
	if (!value) return { month: "", day: "", year: "" };
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (!m) return { month: "", day: "", year: "" };
	return {
		month: String(Number.parseInt(m[2], 10)),
		day: String(Number.parseInt(m[3], 10)),
		year: m[1],
	};
}

export function formatBirthday(month: string, day: string, year: string): string | null {
	const m = Number.parseInt(month, 10);
	const d = Number.parseInt(day, 10);
	const y = Number.parseInt(year, 10);
	if (!m || !d || !y) return null;
	if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
	const mm = String(m).padStart(2, "0");
	const dd = String(d).padStart(2, "0");
	return `${y}-${mm}-${dd}`;
}

function daysInMonth(month: number, year: number): number {
	if (!month) return 31;
	if (month === 2) {
		const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
		return leap ? 29 : 28;
	}
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function BirthdaySelect({
	value,
	onSave,
	disabled,
}: {
	value: string | null;
	onSave: (serialized: string | null) => void;
	disabled?: boolean;
}) {
	const initial = parseBirthday(value);
	const [month, setMonth] = useState(initial.month);
	const [day, setDay] = useState(initial.day);
	const [year, setYear] = useState(initial.year);

	useEffect(() => {
		const parsed = parseBirthday(value);
		setMonth(parsed.month);
		setDay(parsed.day);
		setYear(parsed.year);
	}, [value]);

	const current = formatBirthday(month, day, year);
	const stored = value ?? null;
	const dirty = current !== stored;
	const y = Number.parseInt(year, 10) || new Date().getFullYear();
	const maxDay = daysInMonth(Number.parseInt(month, 10) || 0, y);
	const selectCls =
		"border border-gray-a4 rounded-md px-2 py-1.5 text-3 text-gray-12 bg-gray-a2";

	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="text-3 font-medium text-gray-12">Birthday</span>
			<select
				className={selectCls}
				value={month}
				onChange={(e) => setMonth(e.target.value)}
				disabled={disabled}
				aria-label="Birthday month"
			>
				<option value="">Month</option>
				{MONTHS.map((name, i) => (
					<option key={name} value={String(i + 1)}>
						{name}
					</option>
				))}
			</select>
			<select
				className={selectCls}
				value={day}
				onChange={(e) => setDay(e.target.value)}
				disabled={disabled}
				aria-label="Birthday day"
			>
				<option value="">Day</option>
				{Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
					<option key={d} value={String(d)}>
						{d}
					</option>
				))}
			</select>
			<input
				className={`${selectCls} w-24`}
				type="number"
				inputMode="numeric"
				min={1900}
				max={2200}
				placeholder="Year (opt)"
				value={year}
				onChange={(e) => setYear(e.target.value)}
				disabled={disabled}
				aria-label="Birthday year"
			/>
			<button
				type="button"
				className="text-3 px-3 py-1.5 rounded-md border border-gray-a5 text-gray-12 bg-gray-a2 hover:bg-gray-a3 disabled:opacity-50"
				disabled={disabled || !dirty}
				onClick={() => onSave(current)}
			>
				Save
			</button>
		</div>
	);
}
