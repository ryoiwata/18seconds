"use client"

// <OptionButton> — tall full-width rectangular option button matching
// the data/example_ccat_formatting/*.png reference. Phase 3 polish
// commit 2 restyle: thin gray border, ample vertical padding, an
// unfilled radio-circle bullet on the left followed by the option
// text, no A/B/C/D/E letter label visible (screenshots show no letter).
//
// NOTE — DEVIATION FROM PLAN §5.1: the plan said "the A/B/C/D/E label
// as a filled left tab on the rectangle." The reference screenshots do
// not show such a label — they show a radio-circle bullet only. The
// screenshots are authoritative per the commit-2 instructions. The
// `displayLabel` prop is retained on the type so the existing keyboard-
// nav handler in <ItemPrompt> still computes A/B/C/D/E for keypress
// resolution; it's just not rendered. If a future commit reintroduces a
// visible letter label, set the prop's render path back on without
// changing call sites.
//
// Selected-state visual: filled radio dot, light primary background,
// dark primary border (matches screenshot 3 + 5 — "112" / "0.45"
// selected states).
// Hover-state visual: darker border without circle fill (matches
// screenshot 2 + 6 — "105" / "56% of the voters were men" hover).

import * as React from "react"
import { cn } from "@/lib/utils"

interface OptionButtonProps {
	id: string
	// Retained for type-compat with <ItemPrompt>'s render loop and the
	// keyboard-nav A/B/C/D/E mapping. Not rendered post-commit-2.
	displayLabel: string
	text: string
	selected: boolean
	onSelect: () => void
}

function OptionButtonImpl(props: OptionButtonProps) {
	const { text, selected, onSelect } = props
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"flex w-full items-center gap-4 rounded-md border px-5 py-4 text-left text-base transition-colors",
				"border-border bg-background text-foreground hover:border-foreground/40",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				selected && "border-primary bg-primary/5 text-foreground"
			)}
		>
			{/* Radio-circle bullet. Outer ring + inner dot only when selected.
			    Matches the reference screenshots' filled-orange selected dot. */}
			<span
				aria-hidden="true"
				className={cn(
					"relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
					selected ? "border-primary" : "border-foreground/40"
				)}
			>
				<span
					className={cn(
						"h-2.5 w-2.5 rounded-full transition-opacity",
						selected ? "bg-primary opacity-100" : "opacity-0"
					)}
				/>
			</span>
			<span className="flex-1">{text}</span>
		</button>
	)
}

const OptionButton = React.memo(OptionButtonImpl)

export type { OptionButtonProps }
export { OptionButton }
