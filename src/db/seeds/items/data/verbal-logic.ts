import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "verbal.logic",
		difficulty: "easy",
		body: {
			kind: "text",
			text: "All robins are birds. All birds have feathers. Which conclusion follows?"
		},
		options: [
			{ id: "A", text: "All robins have feathers." },
			{ id: "B", text: "All birds are robins." },
			{ id: "C", text: "Only robins have feathers." },
			{ id: "D", text: "Some robins do not have feathers." }
		],
		correctAnswer: "A",
		explanation: "Transitivity: robins ⊂ birds, birds have feathers, so robins have feathers."
	},
	{
		subTypeId: "verbal.logic",
		difficulty: "easy",
		body: {
			kind: "text",
			text: "If it is raining, the field is wet. The field is not wet. Which conclusion follows?"
		},
		options: [
			{ id: "A", text: "It is raining." },
			{ id: "B", text: "It is not raining." },
			{ id: "C", text: "It will rain soon." },
			{ id: "D", text: "The field is dry because of the sun." }
		],
		correctAnswer: "B",
		explanation: "Modus tollens: rain → wet field; field not wet, so it is not raining."
	},
	{
		subTypeId: "verbal.logic",
		difficulty: "medium",
		body: {
			kind: "text",
			text: "No reptiles are mammals. All snakes are reptiles. Which conclusion must be true?"
		},
		options: [
			{ id: "A", text: "All mammals are snakes." },
			{ id: "B", text: "Some snakes are mammals." },
			{ id: "C", text: "No snakes are mammals." },
			{ id: "D", text: "All reptiles are snakes." }
		],
		correctAnswer: "C",
		explanation: "Snakes ⊂ reptiles, and reptiles ∩ mammals = ∅, so snakes ∩ mammals = ∅."
	},
	{
		subTypeId: "verbal.logic",
		difficulty: "medium",
		body: {
			kind: "text",
			text: "Every employee at the firm has a security badge. Mira has a security badge. Which conclusion must be true?"
		},
		options: [
			{ id: "A", text: "Mira is an employee at the firm." },
			{ id: "B", text: "Mira is not an employee at the firm." },
			{ id: "C", text: "If Mira is an employee at the firm, she has a security badge." },
			{ id: "D", text: "Everyone with a security badge is an employee at the firm." }
		],
		correctAnswer: "C",
		explanation: "Affirming the consequent is invalid; only the original conditional, restricted to Mira, can be reaffirmed."
	},
	{
		subTypeId: "verbal.logic",
		difficulty: "hard",
		body: {
			kind: "text",
			text: "All physicists at the conference are also mathematicians. Some mathematicians at the conference are not physicists. Which statement must be true?"
		},
		options: [
			{ id: "A", text: "There are mathematicians at the conference who are not physicists." },
			{ id: "B", text: "All mathematicians at the conference are physicists." },
			{ id: "C", text: "No physicists at the conference are mathematicians." },
			{ id: "D", text: "There are no mathematicians at the conference." }
		],
		correctAnswer: "A",
		explanation: "The second premise directly states there exist mathematicians (at the conference) who are not physicists."
	}
]

export { items }
