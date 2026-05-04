import { frostedThemePlugin } from "@whop/react/tailwind";
import colors from "tailwindcss/colors";

/**
 * `frostedThemePlugin` REPLACES Tailwind's default `theme.colors` with
 * Frosted UI's CSS-variable-driven palette (`gray-1`…`gray-12`,
 * `accent-1`…`accent-12`, plus a handful of semantic tokens). This
 * means utility classes like `bg-slate-50`, `text-emerald-600`,
 * `bg-red-500`, etc. silently compile to nothing — they're not in the
 * palette anymore, so they're stripped from the output.
 *
 * `theme.extend.colors` is merged on top of the plugin's `theme.colors`
 * after the plugin runs, so re-exposing the standard Tailwind palette
 * here gives the rest of the app (e.g. `/plan/[planId]`) access to its
 * familiar colour names without disturbing Frosted UI's `gray` /
 * `accent` scales used by the rest of the codebase.
 */
export default {
	plugins: [frostedThemePlugin()],
	theme: {
		extend: {
			colors: {
				slate: colors.slate,
				zinc: colors.zinc,
				neutral: colors.neutral,
				stone: colors.stone,
				red: colors.red,
				orange: colors.orange,
				amber: colors.amber,
				yellow: colors.yellow,
				lime: colors.lime,
				green: colors.green,
				emerald: colors.emerald,
				teal: colors.teal,
				cyan: colors.cyan,
				sky: colors.sky,
				blue: colors.blue,
				indigo: colors.indigo,
				violet: colors.violet,
				purple: colors.purple,
				fuchsia: colors.fuchsia,
				pink: colors.pink,
				rose: colors.rose,

				/* OpenReel editor colour tokens — values come from
				   CSS custom properties scoped to `.openreel-editor`
				   in globals.css, so they only resolve inside the
				   editor container. */
				background: {
					DEFAULT: "var(--or-bg, transparent)",
					secondary: "var(--or-bg-secondary, transparent)",
					tertiary: "var(--or-bg-tertiary, transparent)",
					elevated: "var(--or-bg-elevated, transparent)",
				},
				foreground: "var(--or-text-primary, inherit)",
				text: {
					primary: "var(--or-text-primary, inherit)",
					secondary: "var(--or-text-secondary, inherit)",
					muted: "var(--or-text-muted, inherit)",
				},
				primary: {
					DEFAULT: "var(--or-primary, #22c55e)",
					foreground: "var(--or-primary-fg, #000)",
				},
				secondary: {
					DEFAULT: "var(--or-secondary, transparent)",
					foreground: "var(--or-secondary-fg, inherit)",
				},
				muted: {
					DEFAULT: "var(--or-muted, transparent)",
					foreground: "var(--or-muted-fg, inherit)",
				},
				accent: {
					DEFAULT: "var(--or-accent, transparent)",
					foreground: "var(--or-accent-fg, inherit)",
				},
				destructive: {
					DEFAULT: "var(--or-destructive, #ef4444)",
					foreground: "var(--or-destructive-fg, #fff)",
				},
				border: "var(--or-border, transparent)",
				input: "var(--or-input, transparent)",
				ring: "var(--or-ring, #22c55e)",
				card: {
					DEFAULT: "var(--or-card, transparent)",
					foreground: "var(--or-card-fg, inherit)",
				},
				popover: {
					DEFAULT: "var(--or-popover, transparent)",
					foreground: "var(--or-popover-fg, inherit)",
				},
			},
		},
	},
};
