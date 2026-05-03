import type { SubTypeId } from "@/config/sub-types"
import type { SeedItemInput } from "@/db/seeds/items/types"
import { items as numericalAveragesRatios } from "@/db/seeds/items/data/numerical-averages-ratios"
import { items as numericalFractions } from "@/db/seeds/items/data/numerical-fractions"
import { items as numericalLetterSeries } from "@/db/seeds/items/data/numerical-letter-series"
import { items as numericalNumberSeries } from "@/db/seeds/items/data/numerical-number-series"
import { items as numericalPercentages } from "@/db/seeds/items/data/numerical-percentages"
import { items as numericalWordProblems } from "@/db/seeds/items/data/numerical-word-problems"
import { items as verbalAnalogies } from "@/db/seeds/items/data/verbal-analogies"
import { items as verbalAntonyms } from "@/db/seeds/items/data/verbal-antonyms"
import { items as verbalLogic } from "@/db/seeds/items/data/verbal-logic"
import { items as verbalSentenceCompletion } from "@/db/seeds/items/data/verbal-sentence-completion"
import { items as verbalSynonyms } from "@/db/seeds/items/data/verbal-synonyms"

const seedDataBySubType: Record<SubTypeId, SeedItemInput[]> = {
	"verbal.synonyms": verbalSynonyms,
	"verbal.antonyms": verbalAntonyms,
	"verbal.analogies": verbalAnalogies,
	"verbal.sentence_completion": verbalSentenceCompletion,
	"verbal.logic": verbalLogic,
	"numerical.number_series": numericalNumberSeries,
	"numerical.letter_series": numericalLetterSeries,
	"numerical.word_problems": numericalWordProblems,
	"numerical.fractions": numericalFractions,
	"numerical.percentages": numericalPercentages,
	"numerical.averages_ratios": numericalAveragesRatios
}

export { seedDataBySubType }
