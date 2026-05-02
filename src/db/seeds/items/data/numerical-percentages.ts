import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "numerical.percentages",
		difficulty: "easy",
		body: { kind: "text", text: "What is 25% of 80?" },
		options: [
			{ id: "A", text: "15" },
			{ id: "B", text: "20" },
			{ id: "C", text: "25" },
			{ id: "D", text: "30" }
		],
		correctAnswer: "B",
		explanation: "25% of 80 = 80 ÷ 4 = 20."
	},
	{
		subTypeId: "numerical.percentages",
		difficulty: "easy",
		body: { kind: "text", text: "What is 10% of 250?" },
		options: [
			{ id: "A", text: "20" },
			{ id: "B", text: "25" },
			{ id: "C", text: "30" },
			{ id: "D", text: "50" }
		],
		correctAnswer: "B",
		explanation: "10% of 250 = 250 ÷ 10 = 25."
	},
	{
		subTypeId: "numerical.percentages",
		difficulty: "medium",
		body: { kind: "text", text: "A jacket originally costs $80. After a 15% discount, what is the sale price?" },
		options: [
			{ id: "A", text: "$60" },
			{ id: "B", text: "$65" },
			{ id: "C", text: "$68" },
			{ id: "D", text: "$72" }
		],
		correctAnswer: "C",
		explanation: "Discount = 0.15 × 80 = 12; sale price = 80 − 12 = $68."
	},
	{
		subTypeId: "numerical.percentages",
		difficulty: "medium",
		body: {
			kind: "text",
			text: "A salary of $40,000 increases by 12%. What is the new salary?"
		},
		options: [
			{ id: "A", text: "$42,800" },
			{ id: "B", text: "$44,000" },
			{ id: "C", text: "$44,800" },
			{ id: "D", text: "$48,000" }
		],
		correctAnswer: "C",
		explanation: "12% of 40,000 = 4,800; 40,000 + 4,800 = 44,800."
	},
	{
		subTypeId: "numerical.percentages",
		difficulty: "hard",
		body: {
			kind: "text",
			text: "A price rises 20% then falls 20%. The final price is what percent of the original?"
		},
		options: [
			{ id: "A", text: "100%" },
			{ id: "B", text: "98%" },
			{ id: "C", text: "96%" },
			{ id: "D", text: "92%" }
		],
		correctAnswer: "C",
		explanation: "1.20 × 0.80 = 0.96, so the final price is 96% of the original."
	}
]

export { items }
