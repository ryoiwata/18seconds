// <TriageAdherenceLine> — low-contrast 30-day rolling triage adherence
// indicator on the Mastery Map. Plan §6.3 / §4.5.
//
// `ratio` is null when fewer than 3 prompts fired in the rolling window
// (the small-sample branch from SPEC §9.7); render the small-sample
// language instead of a percentage. Otherwise render percentage rounded
// to integer per PRD §5.2.

interface TriageAdherenceLineProps {
	fired: number
	taken: number
	ratio: number | null
}

function formatLine(props: TriageAdherenceLineProps): string {
	if (props.ratio === null) {
		return `Triage adherence (30 d): small sample — ${props.fired} prompts so far.`
	}
	const pct = Math.round(props.ratio * 100)
	return `Triage adherence (30 d): ${pct}% (${props.taken}/${props.fired}).`
}

function TriageAdherenceLine(props: TriageAdherenceLineProps) {
	const line = formatLine(props)
	return <p className="text-foreground/40 text-xs">{line}</p>
}

export type { TriageAdherenceLineProps }
export { TriageAdherenceLine, formatLine }
