import { z } from "zod"
import type { Difficulty, SubTypeId } from "@/config/sub-types"

const BodyText = z.object({
	kind: z.literal("text"),
	text: z.string().min(1)
})

const ItemBody = z.discriminatedUnion("kind", [BodyText])

const Option = z.object({
	text: z.string().min(1)
})

const generatedItem = z.object({
	body: ItemBody,
	options: z.array(Option).min(2).max(5),
	correctAnswer: z.string().min(1),
	explanation: z.string().min(1)
})

type GeneratedItem = z.infer<typeof generatedItem>

interface ItemTemplate {
	subTypeId: SubTypeId
	version: number
	systemPrompt: string
	userPromptFor: (difficulty: Difficulty) => string
	schema: typeof generatedItem
}

const COMMON_SYSTEM = [
	"You are generating a single Criteria Cognitive Aptitude Test (CCAT) practice item for an adult test-prep app.",
	"The CCAT gives the user roughly 18 seconds per question.",
	"Output must validate against the provided JSON schema. No prose outside the JSON.",
	"Provide between 4 and 5 options, each with just its text; the system will assign ids.",
	"correctAnswer must equal exactly one of the option ids.",
	"explanation must be one or two sentences explaining why the answer is correct."
].join(" ")

function difficultyHint(difficulty: Difficulty): string {
	if (difficulty === "easy") {
		return "Difficulty: easy. The expected solver hits this in under 8 seconds."
	}
	if (difficulty === "medium") {
		return "Difficulty: medium. The expected solver hits this in 8–14 seconds."
	}
	if (difficulty === "hard") {
		return "Difficulty: hard. The expected solver hits this in 14–18 seconds; clear traps for inattention."
	}
	return "Difficulty: brutal. The expected solver hits this only above the 18-second target; should reward triage."
}

function buildTemplate(
	subTypeId: SubTypeId,
	systemTail: string,
	userPromptStem: (difficulty: Difficulty) => string
): ItemTemplate {
	return {
		subTypeId,
		version: 1,
		systemPrompt: `${COMMON_SYSTEM} ${systemTail}`,
		userPromptFor: (difficulty) => `${userPromptStem(difficulty)}\n${difficultyHint(difficulty)}`,
		schema: generatedItem
	}
}

const itemTemplates: Record<SubTypeId, ItemTemplate> = {
	"verbal.synonyms": buildTemplate(
		"verbal.synonyms",
		"Generate a CCAT synonyms item: a target word and four to five candidate options of which one is the closest synonym.",
		(difficulty) =>
			`Generate one CCAT synonyms item at ${difficulty} difficulty. The body.text must be a single target word. Options are candidate synonyms.`
	),
	"verbal.antonyms": buildTemplate(
		"verbal.antonyms",
		"Generate a CCAT antonyms item: a target word and four to five candidate options of which one is the clearest opposite.",
		(difficulty) =>
			`Generate one CCAT antonyms item at ${difficulty} difficulty. The body.text must be a single target word. Options are candidate antonyms.`
	),
	"verbal.analogies": buildTemplate(
		"verbal.analogies",
		"Generate a CCAT analogy item in the form A : B :: C : ?. Options complete the second pair such that the relationship matches.",
		(difficulty) =>
			`Generate one CCAT analogy item at ${difficulty} difficulty. body.text contains the partial analogy in the form 'A : B :: C : ?'.`
	),
	"verbal.sentence_completion": buildTemplate(
		"verbal.sentence_completion",
		"Generate a CCAT sentence-completion item: a sentence with one or two blanks and four to five options that fill the blanks.",
		(difficulty) =>
			`Generate one CCAT sentence-completion item at ${difficulty} difficulty. body.text contains the sentence with blanks marked as '___'.`
	),
	"verbal.logic": buildTemplate(
		"verbal.logic",
		"Generate a CCAT verbal-logic item: a short premise (or pair of premises) and a candidate conclusion. Options are True / False / Uncertain or labeled equivalents. Spatial-direction problems are valid.",
		(difficulty) =>
			`Generate one CCAT verbal-logic item at ${difficulty} difficulty. body.text contains the premises and the candidate conclusion.`
	),
	"numerical.number_series": buildTemplate(
		"numerical.number_series",
		"Generate a CCAT number-series item: a sequence of numbers with one missing term (the next term). Options are candidate next terms.",
		(difficulty) =>
			`Generate one CCAT number-series item at ${difficulty} difficulty. body.text contains the sequence ending in '?'. Underlying rule should be guessable in under 18 seconds.`
	),
	"numerical.letter_series": buildTemplate(
		"numerical.letter_series",
		"Generate a CCAT letter-series item: a sequence of letters or letter groups with one missing term. Options are candidate next terms.",
		(difficulty) =>
			`Generate one CCAT letter-series item at ${difficulty} difficulty. body.text contains the sequence ending in '?'. Underlying rule maps to alphabet positions.`
	),
	"numerical.word_problems": buildTemplate(
		"numerical.word_problems",
		"Generate a CCAT arithmetic word-problem item: a short real-world scenario with one numeric answer. No calculator. Math should be light (one or two steps).",
		(difficulty) =>
			`Generate one CCAT word-problem item at ${difficulty} difficulty. body.text contains the problem statement. Options are candidate numeric answers.`
	),
	"numerical.fractions": buildTemplate(
		"numerical.fractions",
		"Generate a CCAT fractions item: compare fractions, pick the largest/smallest, or convert between forms. Options are fractions or numeric answers.",
		(difficulty) =>
			`Generate one CCAT fractions item at ${difficulty} difficulty. body.text contains the question and the fraction set if needed.`
	),
	"numerical.percentages": buildTemplate(
		"numerical.percentages",
		"Generate a CCAT percentages item: compute a percent change, percent-of, or relative comparison. Options are numeric answers.",
		(difficulty) =>
			`Generate one CCAT percentages item at ${difficulty} difficulty. body.text contains the scenario.`
	),
	"numerical.averages_ratios": buildTemplate(
		"numerical.averages_ratios",
		"Generate a CCAT averages-and-ratios item: compute a mean, weighted average, or ratio split. Options are numeric answers.",
		(difficulty) =>
			`Generate one CCAT averages-or-ratios item at ${difficulty} difficulty. body.text contains the scenario.`
	)
}

export type { GeneratedItem, ItemTemplate }
export { generatedItem, itemTemplates }
