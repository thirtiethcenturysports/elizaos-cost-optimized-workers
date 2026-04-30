// Model downgrade example
// Use the cheapest model that meets quality threshold. Escalate only on low confidence.

type ModelTier = 'cheap' | 'mid' | 'expensive';

interface ModelResult {
  output: string;
  confidence: number;
  tier: ModelTier;
  cost: number;
}

const COST_BY_TIER: Record<ModelTier, number> = {
  cheap: 0.0001,
  mid: 0.001,
  expensive: 0.01,
};

const CONFIDENCE_THRESHOLD = 0.75;

async function generateWithDowngrade(prompt: string): Promise<ModelResult> {
  const tiers: ModelTier[] = ['cheap', 'mid', 'expensive'];

  for (const tier of tiers) {
    const result = await callModel(prompt, tier);
    if (result.confidence >= CONFIDENCE_THRESHOLD) {
      return result;
    }
  }

  // Fall through: return last (expensive) result regardless
  return callModel(prompt, 'expensive');
}

async function callModel(prompt: string, tier: ModelTier): Promise<ModelResult> {
  // Placeholder: real impl dispatches to tier-specific worker
  return {
    output: 'placeholder',
    confidence: tier === 'cheap' ? 0.6 : tier === 'mid' ? 0.85 : 0.95,
    tier,
    cost: COST_BY_TIER[tier],
  };
}

export { generateWithDowngrade };
