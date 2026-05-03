import type { SeedItemInput } from "@/db/seeds/items/types"

const items: SeedItemInput[] = [
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "easy",
		body: { kind: "text", text: "What is the average of 4, 6, and 8?" },
		options: [
			{ text: "5" },
			{ text: "6" },
			{ text: "7" },
			{ text: "8" }
		],
		correctAnswerIndex: 1,
		explanation: "(4 + 6 + 8) ÷ 3 = 18 ÷ 3 = 6."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "easy",
		body: { kind: "text", text: "If the ratio of cats to dogs is 3 : 2, and there are 9 cats, how many dogs are there?" },
		options: [
			{ text: "4" },
			{ text: "6" },
			{ text: "8" },
			{ text: "12" }
		],
		correctAnswerIndex: 1,
		explanation: "3 cats per 2 dogs; 9 cats ÷ 3 = 3 groups; 3 × 2 = 6 dogs."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "medium",
		body: { kind: "text", text: "The average of five numbers is 12. If four of the numbers are 8, 10, 14, and 15, what is the fifth?" },
		options: [
			{ text: "11" },
			{ text: "12" },
			{ text: "13" },
			{ text: "14" }
		],
		correctAnswerIndex: 2,
		explanation: "Total = 5 × 12 = 60; 60 − (8 + 10 + 14 + 15) = 60 − 47 = 13."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "medium",
		body: { kind: "text", text: "A recipe uses flour and sugar in a 5 : 3 ratio. If 24 ounces of sugar are used, how many ounces of flour are used?" },
		options: [
			{ text: "30" },
			{ text: "32" },
			{ text: "36" },
			{ text: "40" }
		],
		correctAnswerIndex: 3,
		explanation: "Sugar : flour = 3 : 5; 24 / 3 = 8 per part; 5 × 8 = 40 ounces of flour."
	},
	{
		subTypeId: "numerical.averages_ratios",
		difficulty: "hard",
		body: { kind: "text", text: "A class of 20 students has an average score of 80. After a new student joins, the average becomes 81. What is the new student's score?" },
		options: [
			{ text: "81" },
			{ text: "85" },
			{ text: "98" },
			{ text: "101" }
		],
		correctAnswerIndex: 3,
		explanation: "Original total = 20 × 80 = 1600; new total = 21 × 81 = 1701; new score = 1701 − 1600 = 101."
	}
]

export { items }
