"use client"

// <ItemPrompt> — renders the question body + the radio-style option
// buttons. Mouse-and-click only; no keyboard option-selection
// shortcuts.
//
// Phase 3 polish commit 3 stripped the digit (1–5) + letter (A–E)
// keyboard nav and the visible A/B/C/D/E label per
// docs/plans/phase-3-polish-practice-surface-features.md §3.0 / §3.1.
// The real CCAT is a browser-based mouse-and-click test with no
// keyboard shortcuts; training muscle memory the real test won't honor
// is a regression dressed as ergonomics. Selection is now click-only.
// The triage prompt's `Space` shortcut stays because the triage prompt
// is our pedagogical layer, not CCAT mechanics.

import type * as React from "react"
import { TextBody } from "@/components/item/body-renderers/text"
import { OptionButton } from "@/components/item/option-button"
import type { ItemBody } from "@/server/items/body-schema"

interface ItemPromptOption {
	id: string
	text: string
}

interface ItemPromptProps {
	body: ItemBody
	options: ItemPromptOption[]
	selectedOptionId?: string
	onSelect: (id: string) => void
}

function ItemPrompt(props: ItemPromptProps) {
	const { body, options, selectedOptionId, onSelect } = props
	return (
		<div className="flex flex-col gap-6">
			<div>{renderBody(body)}</div>
			<div className="flex flex-col gap-2">
				{options.map(function renderOption(option) {
					return (
						<OptionButton
							key={option.id}
							id={option.id}
							text={option.text}
							selected={option.id === selectedOptionId}
							onSelect={function selectThis() {
								onSelect(option.id)
							}}
						/>
					)
				})}
			</div>
		</div>
	)
}

function renderBody(body: ItemBody): React.ReactNode {
	switch (body.kind) {
		case "text":
			return <TextBody text={body.text} />
		default: {
			// Exhaustiveness check: adding a new variant to ItemBody fails the
			// compile here until the renderer handles it.
			const _exhaustive: never = body.kind
			return _exhaustive
		}
	}
}

export type { ItemPromptOption, ItemPromptProps }
export { ItemPrompt }
