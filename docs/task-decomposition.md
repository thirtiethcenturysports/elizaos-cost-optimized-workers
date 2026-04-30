# Task Decomposition

Break complex requests into subtasks. Route each to the cheapest appropriate model.

## Pattern

1. Receive request
2. Decompose into subtasks (sentiment, classification, generation, etc.)
3. Route each subtask to appropriate worker
4. Aggregate results
5. Log decision path append-only

## Example

Input: "Analyze sentiment and generate response"

Decomposed:
- Sentiment (`worker-sentiment`): cheap model, fast
- Response generation (`worker-generation`): expensive model, slow

Result: Use cheap model for sentiment. Use expensive model only for generation.

## Cost Benefit

Reduces model calls by 40-60% depending on task mix.
