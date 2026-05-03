"use client"

// <ItemSlot> — the latency-anchor host. Mounted by <FocusShell> with a
// React `key` set to `currentItem.id` so React remounts on every item
// swap. The mount-effect captures `performance.now()` and dispatches
// `set_question_started`; that timestamp is what `submit`'s latency
// calculation subtracts from to compute the per-question latency.
//
// Plan §5.3 / §9.1 — DO NOT lift this into a non-keyed render. If the
// effect runs once per session instead of once per item, every
// `latencyMs` becomes "time since session start." The `submitAttempt`
// server action has a 5-minute tripwire that throws on out-of-band
// values (see src/server/sessions/submit.ts), but the contract is the
// keyed mount; the tripwire is the safety net.

import * as React from "react"
import { ItemPrompt } from "@/components/item/item-prompt"
import type { ItemForRender } from "@/components/focus-shell/types"

interface ItemSlotProps {
	item: ItemForRender
	selectedOptionId?: string
	onSelectOption: (optionId: string) => void
	onMounted: (nowMs: number) => void
}

function ItemSlot(props: ItemSlotProps) {
	const onMounted = props.onMounted
	React.useEffect(function captureFirstPaint() {
		// Empty deps: re-runs on every mount, which is one mount per
		// keyed item swap. The component above sets the React key.
		onMounted(performance.now())
	}, [onMounted])

	return (
		<ItemPrompt
			body={props.item.body}
			options={props.item.options}
			selectedOptionId={props.selectedOptionId}
			onSelect={props.onSelectOption}
		/>
	)
}

export type { ItemSlotProps }
export { ItemSlot }
