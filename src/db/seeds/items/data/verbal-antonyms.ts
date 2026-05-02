import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "verbal.antonyms",
		difficulty: "easy",
		body: { kind: "text", text: "Choose the word that is most nearly the OPPOSITE of HOT." },
		options: [
			{ id: "A", text: "warm" },
			{ id: "B", text: "tepid" },
			{ id: "C", text: "cold" },
			{ id: "D", text: "humid" }
		],
		correctAnswer: "C",
		explanation: "'Cold' is the direct opposite of HOT."
	},
	{
		subTypeId: "verbal.antonyms",
		difficulty: "easy",
		body: { kind: "text", text: "Choose the word that is most nearly the OPPOSITE of FAST." },
		options: [
			{ id: "A", text: "rapid" },
			{ id: "B", text: "slow" },
			{ id: "C", text: "loud" },
			{ id: "D", text: "early" }
		],
		correctAnswer: "B",
		explanation: "'Slow' is the direct opposite of FAST."
	},
	{
		subTypeId: "verbal.antonyms",
		difficulty: "medium",
		body: { kind: "text", text: "Choose the word that is most nearly the OPPOSITE of SCARCE." },
		options: [
			{ id: "A", text: "abundant" },
			{ id: "B", text: "expensive" },
			{ id: "C", text: "useful" },
			{ id: "D", text: "limited" }
		],
		correctAnswer: "A",
		explanation: "'Scarce' means rare or in short supply; 'abundant' is its opposite."
	},
	{
		subTypeId: "verbal.antonyms",
		difficulty: "medium",
		body: { kind: "text", text: "Choose the word that is most nearly the OPPOSITE of PRAISE." },
		options: [
			{ id: "A", text: "applaud" },
			{ id: "B", text: "criticize" },
			{ id: "C", text: "ignore" },
			{ id: "D", text: "study" }
		],
		correctAnswer: "B",
		explanation: "'Criticize' (find fault with) is the most direct opposite of PRAISE."
	},
	{
		subTypeId: "verbal.antonyms",
		difficulty: "hard",
		body: { kind: "text", text: "Choose the word that is most nearly the OPPOSITE of GREGARIOUS." },
		options: [
			{ id: "A", text: "talkative" },
			{ id: "B", text: "outgoing" },
			{ id: "C", text: "reclusive" },
			{ id: "D", text: "courteous" }
		],
		correctAnswer: "C",
		explanation: "'Gregarious' means sociable; 'reclusive' (avoiding company) is the opposite."
	}
]

export { items }
