import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "easy",
		body: { kind: "text", text: "What is the average of 4, 6, and 8?" },
		options: [
			{ id: "A", text: "5" },
			{ id: "B", text: "6" },
			{ id: "C", text: "7" },
			{ id: "D", text: "8" }
		],
		correctAnswer: "B",
		explanation: "(4 + 6 + 8) ÷ 3 = 18 ÷ 3 = 6."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "easy",
		body: { kind: "text", text: "If the ratio of cats to dogs is 3 : 2, and there are 9 cats, how many dogs are there?" },
		options: [
			{ id: "A", text: "4" },
			{ id: "B", text: "6" },
			{ id: "C", text: "8" },
			{ id: "D", text: "12" }
		],
		correctAnswer: "B",
		explanation: "3 cats per 2 dogs; 9 cats ÷ 3 = 3 groups; 3 × 2 = 6 dogs."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "medium",
		body: { kind: "text", text: "The average of five numbers is 12. If four of the numbers are 8, 10, 14, and 15, what is the fifth?" },
		options: [
			{ id: "A", text: "11" },
			{ id: "B", text: "12" },
			{ id: "C", text: "13" },
			{ id: "D", text: "14" }
		],
		correctAnswer: "C",
		explanation: "Total = 5 × 12 = 60; 60 − (8 + 10 + 14 + 15) = 60 − 47 = 13."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "medium",
		body: { kind: "text", text: "A recipe uses flour and sugar in a 5 : 3 ratio. If 24 ounces of sugar are used, how many ounces of flour are used?" },
		options: [
			{ id: "A", text: "30" },
			{ id: "B", text: "32" },
			{ id: "C", text: "36" },
			{ id: "D", text: "40" }
		],
		correctAnswer: "D",
		explanation: "Sugar : flour = 3 : 5; 24 / 3 = 8 per part; 5 × 8 = 40 ounces of flour."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "hard",
		body: { kind: "text", text: "A class of 20 students has an average score of 80. After a new student joins, the average becomes 81. What is the new student's score?" },
		options: [
			{ id: "A", text: "81" },
			{ id: "B", text: "85" },
			{ id: "C", text: "98" },
			{ id: "D", text: "101" }
		],
		correctAnswer: "D",
		explanation: "Original total = 20 × 80 = 1600; new total = 21 × 81 = 1701; new score = 1701 − 1600 = 101."
	}
]

export { items }
