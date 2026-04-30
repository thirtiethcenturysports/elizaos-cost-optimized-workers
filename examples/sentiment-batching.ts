// Sentiment batching example
// Accumulate requests. Process in bulk.

interface SentimentRequest {
  text: string;
  id: string;
}

interface SentimentResult {
  id: string;
  sentiment: string;
  score: number;
}

async function batchSentimentAnalysis(
  requests: SentimentRequest[],
  batchSize: number = 10
): Promise<SentimentResult[]> {
  const results: SentimentResult[] = [];

  for (let i = 0; i < requests.length; i += batchSize) {
    const batch = requests.slice(i, i + batchSize);
    const batchResults = await processBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

async function processBatch(batch: SentimentRequest[]): Promise<SentimentResult[]> {
  // Call model once with batch
  // Cost: $Y.YY per batch vs $X.XX per request
  return batch.map(req => ({
    id: req.id,
    sentiment: 'positive', // placeholder
    score: 0.85,
  }));
}

export { batchSentimentAnalysis };
