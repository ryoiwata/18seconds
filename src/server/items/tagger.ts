import Anthropic from "@anthropic-ai/sdk"
import * as errors from "@superbuilders/errors"
import { z } from "zod"
import { type Difficulty, type SubTypeId, subTypeIds, subTypes } from "@/config/sub-types"
import { env } from "@/env"
import { logger } from "@/logger"

const TAGGER_MODEL = "claude-haiku-4-5-20251001"

const FALLBACK: TaggerResult = {
	subTypeId: "verbal.synonyms",
	difficulty: "medium",
	confidence: 0
}

const taggerResponse = z.object({
	subTypeId: z.enum(subTypeIds),
	difficulty: z.enum(["easy", "medium", "hard", "brutal"]),
	confidence: z.number().min(0).max(1)
})

interface TaggerResult {
	subTypeId: SubTypeId
	difficulty: Difficulty
	confidence: number
}

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

async function classifyItem(prompt: string, options: string[]): Promise<TaggerResult> {
	const systemPrompt = buildSystemPrompt()
	const userPrompt = buildUserPrompt(prompt, options)

	const result = await errors.try(
		client.messages.create({
			model: TAGGER_MODEL,
			max_tokens: 256,
			system: systemPrompt,
			messages: [{ role: "user", content: userPrompt }]
		})
	)
	if (result.error) {
		logger.error({ error: result.error, model: TAGGER_MODEL }, "tagger: anthropic call failed")
		throw errors.wrap(result.error, "tagger anthropic.messages.create")
	}

	const message = result.data
	logger.debug(
		{
			model: TAGGER_MODEL,
			tokens_in: message.usage.input_tokens,
			tokens_out: message.usage.output_tokens,
			cost_estimate_usd: null
		},
		"tagger: classification call"
	)

	const text = extractText(message.content)
	if (!text) {
		logger.warn({ model: TAGGER_MODEL }, "tagger: response had no text content; using fallback")
		return FALLBACK
	}

	const json = errors.trySync(function parseJson() {
		return JSON.parse(text)
	})
	if (json.error) {
		logger.warn(
			{ rawOutput: text, error: json.error },
			"tagger: response was not valid JSON; using fallback"
		)
		return FALLBACK
	}

	const parsed = taggerResponse.safeParse(json.data)
	if (!parsed.success) {
		logger.warn(
			{ rawOutput: text, issues: parsed.error.issues },
			"tagger: response failed schema validation; using fallback"
		)
		return FALLBACK
	}

	return parsed.data
}

function extractText(content: Anthropic.ContentBlock[]): string | undefined {
	for (const block of content) {
		if (block.type === "text") {
			return block.text
		}
	}
	return undefined
}

function buildSystemPrompt(): string {
	const lines: string[] = [
		"You are a CCAT (Criteria Cognitive Aptitude Test) item-classification helper.",
		"Given a question prompt and its multiple-choice options, you must classify it into exactly one of the 11 v1 sub-types and assign a difficulty.",
		"",
		"Sub-types:"
	]
	for (const entry of subTypes) {
		lines.push(`- ${entry.id} — ${entry.displayName} (section: ${entry.section})`)
	}
	lines.push(
		"",
		'Difficulty levels: "easy" (under 8s), "medium" (8–14s), "hard" (14–18s), "brutal" (over 18s).',
		"",
		"Respond with a single JSON object and nothing else:",
		'{"subTypeId": "<one of the 11 ids>", "difficulty": "easy|medium|hard|brutal", "confidence": <number from 0 to 1>}'
	)
	return lines.join("\n")
}

function buildUserPrompt(prompt: string, options: string[]): string {
	const optionsBlock = options.map(function formatOption(option, i) {
		const letter = String.fromCharCode("A".charCodeAt(0) + i)
		return `${letter}. ${option}`
	})
	return ["Question:", prompt, "", "Options:", ...optionsBlock].join("\n")
}

export type { TaggerResult }
export { classifyItem, TAGGER_MODEL }
