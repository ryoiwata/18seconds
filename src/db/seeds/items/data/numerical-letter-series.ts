import type { IngestRealItemInput } from "@/server/items/ingest"

const items: IngestRealItemInput[] = [
	{
		subTypeId: "numerical.letter_series",
		difficulty: "easy",
		body: { kind: "text", text: "What letter comes next? A, C, E, G, ___" },
		options: [
			{ id: "A", text: "H" },
			{ id: "B", text: "I" },
			{ id: "C", text: "J" },
			{ id: "D", text: "K" }
		],
		correctAnswer: "B",
		explanation: "Skip every other letter; G + 2 = I."
	},
	{
		subTypeId: "numerical.letter_series",
		difficulty: "easy",
		body: { kind: "text", text: "What letter comes next? Z, X, V, T, ___" },
		options: [
			{ id: "A", text: "S" },
			{ id: "B", text: "R" },
			{ id: "C", text: "Q" },
			{ id: "D", text: "P" }
		],
		correctAnswer: "B",
		explanation: "Decreasing alphabet by 2; T - 2 = R."
	},
	{
		subTypeId: "numerical.letter_series",
		difficulty: "medium",
		body: { kind: "text", text: "What pair comes next? AZ, BY, CX, ___" },
		options: [
			{ id: "A", text: "DV" },
			{ id: "B", text: "DW" },
			{ id: "C", text: "EW" },
			{ id: "D", text: "DX" }
		],
		correctAnswer: "B",
		explanation: "First letter advances forward (A, B, C, D); second letter moves backward (Z, Y, X, W). Next pair: DW."
	},
	{
		subTypeId: "numerical.letter_series",
		difficulty: "medium",
		body: { kind: "text", text: "What letter comes next? B, D, G, K, ___" },
		options: [
			{ id: "A", text: "M" },
			{ id: "B", text: "N" },
			{ id: "C", text: "O" },
			{ id: "D", text: "P" }
		],
		correctAnswer: "D",
		explanation: "Gaps grow by one: B(+2)D(+3)G(+4)K(+5)P. Next is P."
	},
	{
		subTypeId: "numerical.letter_series",
		difficulty: "hard",
		body: { kind: "text", text: "What pair comes next? AB, DE, HI, MN, ___" },
		options: [
			{ id: "A", text: "RS" },
			{ id: "B", text: "ST" },
			{ id: "C", text: "TU" },
			{ id: "D", text: "QR" }
		],
		correctAnswer: "B",
		explanation: "Pairs are consecutive letter-pairs separated by gaps of 1, 2, 3, 4 letters. After MN, skip 4 (O, P, Q, R) to start at S → ST."
	}
]

export { items }
