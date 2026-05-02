import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "numerical.word_problems",
		difficulty: "easy",
		body: {
			kind: "text",
			text: "A box contains 12 apples. If 4 apples are eaten, how many remain?"
		},
		options: [
			{ id: "A", text: "6" },
			{ id: "B", text: "7" },
			{ id: "C", text: "8" },
			{ id: "D", text: "9" }
		],
		correctAnswer: "C",
		explanation: "12 − 4 = 8."
	},
	{
		subTypeId: "numerical.word_problems",
		difficulty: "easy",
		body: {
			kind: "text",
			text: "A pen costs $3. How much do 7 pens cost?"
		},
		options: [
			{ id: "A", text: "$18" },
			{ id: "B", text: "$21" },
			{ id: "C", text: "$24" },
			{ id: "D", text: "$28" }
		],
		correctAnswer: "B",
		explanation: "$3 × 7 = $21."
	},
	{
		subTypeId: "numerical.word_problems",
		difficulty: "medium",
		body: {
			kind: "text",
			text: "A train travels 60 miles in 1.5 hours. At the same speed, how far does it travel in 4 hours?"
		},
		options: [
			{ id: "A", text: "120 miles" },
			{ id: "B", text: "150 miles" },
			{ id: "C", text: "160 miles" },
			{ id: "D", text: "180 miles" }
		],
		correctAnswer: "C",
		explanation: "Speed = 60 ÷ 1.5 = 40 mph; 40 × 4 = 160 miles."
	},
	{
		subTypeId: "numerical.word_problems",
		difficulty: "medium",
		body: {
			kind: "text",
			text: "A class has 30 students. If 60% are girls, how many are boys?"
		},
		options: [
			{ id: "A", text: "10" },
			{ id: "B", text: "12" },
			{ id: "C", text: "15" },
			{ id: "D", text: "18" }
		],
		correctAnswer: "B",
		explanation: "Boys = 40% of 30 = 0.4 × 30 = 12."
	},
	{
		subTypeId: "numerical.word_problems",
		difficulty: "hard",
		body: {
			kind: "text",
			text: "Pipe A fills a tank in 6 hours; pipe B fills it in 12 hours. If both run together, how long do they take to fill the tank?"
		},
		options: [
			{ id: "A", text: "3 hours" },
			{ id: "B", text: "4 hours" },
			{ id: "C", text: "5 hours" },
			{ id: "D", text: "9 hours" }
		],
		correctAnswer: "B",
		explanation: "Combined rate = 1/6 + 1/12 = 3/12 = 1/4 tank per hour, so 4 hours."
	}
]

export { items }
