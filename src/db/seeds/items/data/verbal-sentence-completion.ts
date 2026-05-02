import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "verbal.sentence_completion",
		difficulty: "easy",
		body: {
			kind: "text",
			text: "After the long hike, the children were so ___ that they fell asleep immediately."
		},
		options: [
			{ id: "A", text: "energetic" },
			{ id: "B", text: "tired" },
			{ id: "C", text: "curious" },
			{ id: "D", text: "hungry" }
		],
		correctAnswer: "B",
		explanation: "Falling asleep immediately follows from being tired, not energetic, curious, or hungry."
	},
	{
		subTypeId: "verbal.sentence_completion",
		difficulty: "easy",
		body: {
			kind: "text",
			text: "Although the recipe was simple, the cake turned out ___ because the oven was broken."
		},
		options: [
			{ id: "A", text: "delicious" },
			{ id: "B", text: "perfect" },
			{ id: "C", text: "ruined" },
			{ id: "D", text: "famous" }
		],
		correctAnswer: "C",
		explanation: "A broken oven explains a bad outcome; 'ruined' is the only option that fits the cause."
	},
	{
		subTypeId: "verbal.sentence_completion",
		difficulty: "medium",
		body: {
			kind: "text",
			text: "The committee's decision was met with ___ approval; even members who had opposed the proposal congratulated the chair."
		},
		options: [
			{ id: "A", text: "reluctant" },
			{ id: "B", text: "unanimous" },
			{ id: "C", text: "partial" },
			{ id: "D", text: "delayed" }
		],
		correctAnswer: "B",
		explanation: "Even former opponents congratulating the chair signals everyone agreed; 'unanimous' fits."
	},
	{
		subTypeId: "verbal.sentence_completion",
		difficulty: "medium",
		body: {
			kind: "text",
			text: "Despite extensive preparation, the speaker grew increasingly ___ as the audience filled the room."
		},
		options: [
			{ id: "A", text: "confident" },
			{ id: "B", text: "nervous" },
			{ id: "C", text: "indifferent" },
			{ id: "D", text: "amused" }
		],
		correctAnswer: "B",
		explanation: "'Despite preparation' signals an unexpected response to a growing crowd; 'nervous' captures that tension."
	},
	{
		subTypeId: "verbal.sentence_completion",
		difficulty: "hard",
		body: {
			kind: "text",
			text: "The historian's account was praised for its ___, presenting events without favoring any party in the conflict."
		},
		options: [
			{ id: "A", text: "verbosity" },
			{ id: "B", text: "impartiality" },
			{ id: "C", text: "embellishment" },
			{ id: "D", text: "obscurity" }
		],
		correctAnswer: "B",
		explanation: "'Without favoring any party' defines impartiality."
	}
]

export { items }
