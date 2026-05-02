import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "numerical.fractions",
		difficulty: "easy",
		body: { kind: "text", text: "What is 1/2 + 1/4?" },
		options: [
			{ id: "A", text: "1/6" },
			{ id: "B", text: "2/6" },
			{ id: "C", text: "3/4" },
			{ id: "D", text: "1/3" }
		],
		correctAnswer: "C",
		explanation: "1/2 = 2/4; 2/4 + 1/4 = 3/4."
	},
	{
		subTypeId: "numerical.fractions",
		difficulty: "easy",
		body: { kind: "text", text: "What is 2/3 of 9?" },
		options: [
			{ id: "A", text: "3" },
			{ id: "B", text: "5" },
			{ id: "C", text: "6" },
			{ id: "D", text: "9" }
		],
		correctAnswer: "C",
		explanation: "9 ÷ 3 = 3; 3 × 2 = 6."
	},
	{
		subTypeId: "numerical.fractions",
		difficulty: "medium",
		body: { kind: "text", text: "What is 5/6 − 1/3?" },
		options: [
			{ id: "A", text: "1/3" },
			{ id: "B", text: "1/2" },
			{ id: "C", text: "2/3" },
			{ id: "D", text: "4/6" }
		],
		correctAnswer: "B",
		explanation: "1/3 = 2/6; 5/6 − 2/6 = 3/6 = 1/2."
	},
	{
		subTypeId: "numerical.fractions",
		difficulty: "medium",
		body: { kind: "text", text: "What is 3/4 × 2/3?" },
		options: [
			{ id: "A", text: "1/2" },
			{ id: "B", text: "5/12" },
			{ id: "C", text: "5/7" },
			{ id: "D", text: "6/7" }
		],
		correctAnswer: "A",
		explanation: "3/4 × 2/3 = 6/12 = 1/2."
	},
	{
		subTypeId: "numerical.fractions",
		difficulty: "hard",
		body: { kind: "text", text: "What is 7/8 ÷ 3/4?" },
		options: [
			{ id: "A", text: "21/32" },
			{ id: "B", text: "7/6" },
			{ id: "C", text: "21/24" },
			{ id: "D", text: "4/3" }
		],
		correctAnswer: "B",
		explanation: "7/8 ÷ 3/4 = 7/8 × 4/3 = 28/24 = 7/6."
	}
]

export { items }
