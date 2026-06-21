import { supabase } from '../supabase.js'
import { AI_MODEL_FAMILIES } from './models.js'

const CC_CATEGORY_SLUGS = ['dining', 'travel', 'groceries', 'gas', 'streaming', 'transit', 'online_shopping', 'drugstore', 'other']

const SYSTEM = `You are a financial data classifier. Your only job is to map personal finance budget categories to credit card reward categories and return valid JSON. No explanation, no markdown fences, no extra text — just the raw JSON array.`

export async function suggestCategoryMappings(budgetCategories) {
  if (!budgetCategories || budgetCategories.length === 0) return {}

  // Use integer indices instead of UUIDs to keep the response compact and
  // avoid hitting token limits on large category lists.
  const userPrompt = `Map each of these personal finance budget categories to the best-matching credit card reward category.

Credit card reward categories (use exactly these slugs):
${CC_CATEGORY_SLUGS.map(s => `- "${s}"`).join('\n')}

Budget categories to classify:
${budgetCategories.map((c, i) => `- idx: ${i}, name: "${c.category}"${c.group ? `, group: "${c.group}"` : ''}`).join('\n')}

Rules:
- "dining": restaurants, cafes, fast food, bars, coffee shops, food delivery (DoorDash, Uber Eats)
- "travel": airlines, hotels, car rental, Airbnb, vacation packages, cruises, travel agencies
- "groceries": supermarkets, grocery stores, Costco, Trader Joe's, Whole Foods, farmers market
- "gas": gas stations, fuel, EV charging stations
- "streaming": Netflix, Spotify, Hulu, Disney+, YouTube Premium, Apple TV+, digital subscriptions
- "transit": Uber, Lyft, subway, bus, train, parking, tolls, bike share
- "online_shopping": Amazon, eBay, general online retail, clothing websites, marketplaces
- "drugstore": pharmacy, CVS, Walgreens, Rite Aid, health & beauty retail
- "other": rent, mortgage, utilities, insurance, taxes, medical bills, gym membership, bank fees, home improvement, childcare, education — anything not clearly fitting the above

Return ONLY a JSON array. Each object must have exactly two keys: "idx" (the integer index as given) and "cc_category" (one slug from the list above). No explanation. No markdown. Start with [ and end with ].`

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096,
      modelFamily: AI_MODEL_FAMILIES.assistant,
    },
  })

  if (error) throw new Error(`Could not reach the AI service: ${error.message}`)
  if (data?.error) throw new Error(data.error)

  const raw = data?.text ?? ''

  // Strip markdown fences that the model may add despite instructions
  const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('AI did not return recognisable mappings. Please try again.')
    parsed = JSON.parse(match[0])
  }

  // Handle object wrapper e.g. { "mappings": [...] }
  if (!Array.isArray(parsed)) {
    const arr = Object.values(parsed).find(v => Array.isArray(v))
    if (arr) parsed = arr
    else throw new Error('Unexpected response format from AI.')
  }

  const result = {}
  for (const item of parsed) {
    const cat = budgetCategories[item.idx]
    if (cat && CC_CATEGORY_SLUGS.includes(item.cc_category)) {
      result[cat.id] = item.cc_category
    }
  }
  return result
}
