import type { SeedItemInput } from "@/db/seeds/items/types"

const items: SeedItemInput[] = [
	{
		subTypeId: "verbal.synonyms",
		difficulty: "easy",
		body: { kind: "text", text: "Choose the word that most nearly means HAPPY." },
		options: [
			{ text: "joyful" },
			{ text: "anxious" },
			{ text: "tired" },
			{ text: "angry" }
		],
		correctAnswerIndex: 0,
		explanation: "'Joyful' is the closest synonym for HAPPY among the options."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "easy",
		body: { kind: "text", text: "Choose the word that most nearly means LARGE." },
		options: [
			{ text: "narrow" },
			{ text: "enormous" },
			{ text: "shallow" },
			{ text: "delicate" }
		],
		correctAnswerIndex: 1,
		explanation: "'Enormous' is the closest synonym for LARGE."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "medium",
		body: { kind: "text", text: "Choose the word that most nearly means CANDID." },
		options: [
			{ text: "secretive" },
			{ text: "frank" },
			{ text: "indirect" },
			{ text: "polite" }
		],
		correctAnswerIndex: 1,
		explanation: "'Candid' means open and honest; 'frank' is the closest match."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "medium",
		body: { kind: "text", text: "Choose the word that most nearly means PRUDENT." },
		options: [
			{ text: "reckless" },
			{ text: "wasteful" },
			{ text: "cautious" },
			{ text: "boastful" }
		],
		correctAnswerIndex: 2,
		explanation: "'Prudent' means showing care and thought; 'cautious' is the closest synonym."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "hard",
		body: { kind: "text", text: "Choose the word that most nearly means LACONIC." },
		options: [
			{ text: "verbose" },
			{ text: "concise" },
			{ text: "earnest" },
			{ text: "decorative" }
		],
		correctAnswerIndex: 1,
		explanation: "'Laconic' means using few words; 'concise' is the closest synonym."
	}
]

export { items }
