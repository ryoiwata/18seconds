import type { Difficulty, SubTypeId } from "@/config/sub-types"

interface DiagnosticEntry {
	subTypeId: SubTypeId
	difficulty: Exclude<Difficulty, "brutal">
}

// 50-row hand-tuned mix per the diagnostic-composition decision in
// docs/design_decisions.md. v1 covers 11 text sub-types: 5 verbal × 4 each
// = 20 plus 6 numerical × 5 each = 30. Brutal-tier items are excluded
// (no diagnostic should produce a 0%-accuracy band that contaminates
// the mastery computation). Within each sub-type the tier mix favors
// medium with one easy and one hard (4-item blocks) or one easy and
// one hard with three mediums (5-item blocks).
const diagnosticMix: ReadonlyArray<DiagnosticEntry> = [
	// verbal.synonyms — 4 items
	{ subTypeId: "verbal.synonyms", difficulty: "easy" },
	{ subTypeId: "verbal.synonyms", difficulty: "medium" },
	{ subTypeId: "verbal.synonyms", difficulty: "medium" },
	{ subTypeId: "verbal.synonyms", difficulty: "hard" },
	// verbal.antonyms — 4 items
	{ subTypeId: "verbal.antonyms", difficulty: "easy" },
	{ subTypeId: "verbal.antonyms", difficulty: "medium" },
	{ subTypeId: "verbal.antonyms", difficulty: "medium" },
	{ subTypeId: "verbal.antonyms", difficulty: "hard" },
	// verbal.analogies — 4 items
	{ subTypeId: "verbal.analogies", difficulty: "easy" },
	{ subTypeId: "verbal.analogies", difficulty: "medium" },
	{ subTypeId: "verbal.analogies", difficulty: "medium" },
	{ subTypeId: "verbal.analogies", difficulty: "hard" },
	// verbal.sentence_completion — 4 items
	{ subTypeId: "verbal.sentence_completion", difficulty: "easy" },
	{ subTypeId: "verbal.sentence_completion", difficulty: "medium" },
	{ subTypeId: "verbal.sentence_completion", difficulty: "medium" },
	{ subTypeId: "verbal.sentence_completion", difficulty: "hard" },
	// verbal.logic — 4 items
	{ subTypeId: "verbal.logic", difficulty: "easy" },
	{ subTypeId: "verbal.logic", difficulty: "medium" },
	{ subTypeId: "verbal.logic", difficulty: "medium" },
	{ subTypeId: "verbal.logic", difficulty: "hard" },
	// numerical.number_series — 5 items
	{ subTypeId: "numerical.number_series", difficulty: "easy" },
	{ subTypeId: "numerical.number_series", difficulty: "medium" },
	{ subTypeId: "numerical.number_series", difficulty: "medium" },
	{ subTypeId: "numerical.number_series", difficulty: "medium" },
	{ subTypeId: "numerical.number_series", difficulty: "hard" },
	// numerical.letter_series — 5 items
	{ subTypeId: "numerical.letter_series", difficulty: "easy" },
	{ subTypeId: "numerical.letter_series", difficulty: "medium" },
	{ subTypeId: "numerical.letter_series", difficulty: "medium" },
	{ subTypeId: "numerical.letter_series", difficulty: "medium" },
	{ subTypeId: "numerical.letter_series", difficulty: "hard" },
	// numerical.word_problems — 5 items
	{ subTypeId: "numerical.word_problems", difficulty: "easy" },
	{ subTypeId: "numerical.word_problems", difficulty: "medium" },
	{ subTypeId: "numerical.word_problems", difficulty: "medium" },
	{ subTypeId: "numerical.word_problems", difficulty: "medium" },
	{ subTypeId: "numerical.word_problems", difficulty: "hard" },
	// numerical.fractions — 5 items
	{ subTypeId: "numerical.fractions", difficulty: "easy" },
	{ subTypeId: "numerical.fractions", difficulty: "medium" },
	{ subTypeId: "numerical.fractions", difficulty: "medium" },
	{ subTypeId: "numerical.fractions", difficulty: "medium" },
	{ subTypeId: "numerical.fractions", difficulty: "hard" },
	// numerical.percentages — 5 items
	{ subTypeId: "numerical.percentages", difficulty: "easy" },
	{ subTypeId: "numerical.percentages", difficulty: "medium" },
	{ subTypeId: "numerical.percentages", difficulty: "medium" },
	{ subTypeId: "numerical.percentages", difficulty: "medium" },
	{ subTypeId: "numerical.percentages", difficulty: "hard" },
	// numerical.averages_ratios — 5 items
	{ subTypeId: "numerical.averages_ratios", difficulty: "easy" },
	{ subTypeId: "numerical.averages_ratios", difficulty: "medium" },
	{ subTypeId: "numerical.averages_ratios", difficulty: "medium" },
	{ subTypeId: "numerical.averages_ratios", difficulty: "medium" },
	{ subTypeId: "numerical.averages_ratios", difficulty: "hard" }
]

export type { DiagnosticEntry }
export { diagnosticMix }
