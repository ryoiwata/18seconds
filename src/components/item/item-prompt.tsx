"use client"

import * as React from "react"
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

	// Keyboard navigation per design decision: number keys 1–5 and letter keys A–E
	// select the corresponding option. Submission (Enter / Space) is owned by the
	// FocusShell — we deliberately do not handle it here.
	const onSelectRef = React.useRef(onSelect)
	const optionsRef = React.useRef(options)
	React.useEffect(
		function syncRefs() {
			onSelectRef.current = onSelect
			optionsRef.current = options
		},
		[onSelect, options]
	)

	React.useEffect(function attachKeyboardNav() {
		function handleKeydown(event: KeyboardEvent) {
			const target = event.target
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				return
			}
			const index = optionIndexForKey(event.key)
			if (index < 0) return
			const opt = optionsRef.current[index]
			if (!opt) return
			event.preventDefault()
			onSelectRef.current(opt.id)
		}
		window.addEventListener("keydown", handleKeydown)
		return function detachKeyboardNav() {
			window.removeEventListener("keydown", handleKeydown)
		}
	}, [])

	return (
		<div className="flex flex-col gap-6">
			<div>{renderBody(body)}</div>
			<div className="flex flex-col gap-2">
				{options.map(function renderOption(option, index) {
					const displayLabel = String.fromCharCode(0x41 + index)
					return (
						<OptionButton
							key={option.id}
							id={option.id}
							displayLabel={displayLabel}
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

function optionIndexForKey(key: string): number {
	if (key >= "1" && key <= "5") {
		return key.charCodeAt(0) - "1".charCodeAt(0)
	}
	if (key.length !== 1) return -1
	const upper = key.toUpperCase()
	if (upper >= "A" && upper <= "E") {
		return upper.charCodeAt(0) - "A".charCodeAt(0)
	}
	return -1
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
