import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "verbal.analogies",
		difficulty: "easy",
		body: { kind: "text", text: "PUPPY is to DOG as KITTEN is to ___." },
		options: [
			{ id: "A", text: "mouse" },
			{ id: "B", text: "cat" },
			{ id: "C", text: "fish" },
			{ id: "D", text: "bird" }
		],
		correctAnswer: "B",
		explanation: "A puppy is a young dog; a kitten is a young cat."
	},
	{
		subTypeId: "verbal.analogies",
		difficulty: "easy",
		body: { kind: "text", text: "PETAL is to FLOWER as LEAF is to ___." },
		options: [
			{ id: "A", text: "tree" },
			{ id: "B", text: "stone" },
			{ id: "C", text: "river" },
			{ id: "D", text: "cloud" }
		],
		correctAnswer: "A",
		explanation: "A petal is a part of a flower; a leaf is a part of a tree."
	},
	{
		subTypeId: "verbal.analogies",
		difficulty: "medium",
		body: { kind: "text", text: "AUTHOR is to BOOK as COMPOSER is to ___." },
		options: [
			{ id: "A", text: "stage" },
			{ id: "B", text: "audience" },
			{ id: "C", text: "symphony" },
			{ id: "D", text: "instrument" }
		],
		correctAnswer: "C",
		explanation: "An author creates a book; a composer creates a symphony (a musical work)."
	},
	{
		subTypeId: "verbal.analogies",
		difficulty: "medium",
		body: { kind: "text", text: "OUNCE is to POUND as CENTIMETER is to ___." },
		options: [
			{ id: "A", text: "kilogram" },
			{ id: "B", text: "meter" },
			{ id: "C", text: "liter" },
			{ id: "D", text: "inch" }
		],
		correctAnswer: "B",
		explanation: "There are 16 ounces in a pound and 100 centimeters in a meter — both pairs are smaller-to-larger units of the same kind (mass, length)."
	},
	{
		subTypeId: "verbal.analogies",
		difficulty: "hard",
		body: { kind: "text", text: "CAUTIOUS is to RECKLESS as FRUGAL is to ___." },
		options: [
			{ id: "A", text: "thrifty" },
			{ id: "B", text: "extravagant" },
			{ id: "C", text: "honest" },
			{ id: "D", text: "wealthy" }
		],
		correctAnswer: "B",
		explanation: "Cautious and reckless are antonyms; frugal (sparing) and extravagant (lavish) are antonyms in the same way."
	}
]

export { items }
