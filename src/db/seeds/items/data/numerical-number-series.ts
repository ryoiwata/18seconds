import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "numerical.number_series",
		difficulty: "easy",
		body: { kind: "text", text: "What number comes next? 2, 4, 6, 8, ___" },
		options: [
			{ id: "A", text: "9" },
			{ id: "B", text: "10" },
			{ id: "C", text: "11" },
			{ id: "D", text: "12" }
		],
		correctAnswer: "B",
		explanation: "Arithmetic sequence with common difference +2; 8 + 2 = 10."
	},
	{
		subTypeId: "numerical.number_series",
		difficulty: "easy",
		body: { kind: "text", text: "What number comes next? 5, 10, 20, 40, ___" },
		options: [
			{ id: "A", text: "60" },
			{ id: "B", text: "70" },
			{ id: "C", text: "80" },
			{ id: "D", text: "100" }
		],
		correctAnswer: "C",
		explanation: "Each term doubles; 40 × 2 = 80."
	},
	{
		subTypeId: "numerical.number_series",
		difficulty: "medium",
		body: { kind: "text", text: "What number comes next? 3, 5, 9, 15, 23, ___" },
		options: [
			{ id: "A", text: "30" },
			{ id: "B", text: "31" },
			{ id: "C", text: "33" },
			{ id: "D", text: "35" }
		],
		correctAnswer: "C",
		explanation: "Differences are 2, 4, 6, 8, 10 (increase by 2 each step). 23 + 10 = 33."
	},
	{
		subTypeId: "numerical.number_series",
		difficulty: "medium",
		body: { kind: "text", text: "What number comes next? 1, 4, 9, 16, 25, ___" },
		options: [
			{ id: "A", text: "30" },
			{ id: "B", text: "32" },
			{ id: "C", text: "34" },
			{ id: "D", text: "36" }
		],
		correctAnswer: "D",
		explanation: "Sequence of perfect squares: 1², 2², 3², 4², 5², 6². The next is 6² = 36."
	},
	{
		subTypeId: "numerical.number_series",
		difficulty: "hard",
		body: { kind: "text", text: "What number comes next? 2, 6, 12, 20, 30, ___" },
		options: [
			{ id: "A", text: "40" },
			{ id: "B", text: "42" },
			{ id: "C", text: "44" },
			{ id: "D", text: "48" }
		],
		correctAnswer: "B",
		explanation: "Each term is n(n+1) for n = 1, 2, 3, 4, 5, so n = 6 gives 6 × 7 = 42. (Differences: 4, 6, 8, 10, 12.)"
	}
]

export { items }
