import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "verbal.synonyms",
		difficulty: "easy",
		body: { kind: "text", text: "Choose the word that most nearly means HAPPY." },
		options: [
			{ id: "A", text: "joyful" },
			{ id: "B", text: "anxious" },
			{ id: "C", text: "tired" },
			{ id: "D", text: "angry" }
		],
		correctAnswer: "A",
		explanation: "'Joyful' is the closest synonym for HAPPY among the options."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "easy",
		body: { kind: "text", text: "Choose the word that most nearly means LARGE." },
		options: [
			{ id: "A", text: "narrow" },
			{ id: "B", text: "enormous" },
			{ id: "C", text: "shallow" },
			{ id: "D", text: "delicate" }
		],
		correctAnswer: "B",
		explanation: "'Enormous' is the closest synonym for LARGE."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "medium",
		body: { kind: "text", text: "Choose the word that most nearly means CANDID." },
		options: [
			{ id: "A", text: "secretive" },
			{ id: "B", text: "frank" },
			{ id: "C", text: "indirect" },
			{ id: "D", text: "polite" }
		],
		correctAnswer: "B",
		explanation: "'Candid' means open and honest; 'frank' is the closest match."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "medium",
		body: { kind: "text", text: "Choose the word that most nearly means PRUDENT." },
		options: [
			{ id: "A", text: "reckless" },
			{ id: "B", text: "wasteful" },
			{ id: "C", text: "cautious" },
			{ id: "D", text: "boastful" }
		],
		correctAnswer: "C",
		explanation: "'Prudent' means showing care and thought; 'cautious' is the closest synonym."
	},
	{
		subTypeId: "verbal.synonyms",
		difficulty: "hard",
		body: { kind: "text", text: "Choose the word that most nearly means LACONIC." },
		options: [
			{ id: "A", text: "verbose" },
			{ id: "B", text: "concise" },
			{ id: "C", text: "earnest" },
			{ id: "D", text: "decorative" }
		],
		correctAnswer: "B",
		explanation: "'Laconic' means using few words; 'concise' is the closest synonym."
	}
]

export { items }
