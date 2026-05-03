"use client"

// <DiagnosticOvertimeNote> — peripheral note shown for 15 seconds when
// the diagnostic crosses the 15-minute (real-test time-limit) mark.
// SPEC §6.10 / Plan §1.3.

interface DiagnosticOvertimeNoteProps {
	visible: boolean
}

function DiagnosticOvertimeNote(props: DiagnosticOvertimeNoteProps) {
	if (!props.visible) return null
	return (
		<div
			role="status"
			className="fixed top-4 left-1/2 max-w-md -translate-x-1/2 rounded-md border border-foreground/20 bg-background/80 px-4 py-2 text-center text-foreground/80 text-sm shadow-sm backdrop-blur"
		>
			You're at the real-test time limit; keep going to finish the calibration.
		</div>
	)
}

export type { DiagnosticOvertimeNoteProps }
export { DiagnosticOvertimeNote }
