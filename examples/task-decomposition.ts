// Task decomposition example
// Break a complex request into subtasks. Route each to the right worker.

interface Subtask {
  type: 'sentiment' | 'classification' | 'generation';
  payload: string;
}

interface SubtaskResult {
  type: Subtask['type'];
  output: unknown;
}

async function decomposeAndRun(request: string): Promise<SubtaskResult[]> {
  const subtasks = decompose(request);
  return Promise.all(subtasks.map(runSubtask));
}

function decompose(request: string): Subtask[] {
  const subtasks: Subtask[] = [];

  // Naive decomposition heuristic
  if (/feel|mood|tone/i.test(request)) {
    subtasks.push({ type: 'sentiment', payload: request });
  }
  if (/category|topic|label/i.test(request)) {
    subtasks.push({ type: 'classification', payload: request });
  }
  if (/write|generate|reply|respond/i.test(request)) {
    subtasks.push({ type: 'generation', payload: request });
  }

  if (subtasks.length === 0) {
    subtasks.push({ type: 'generation', payload: request });
  }

  return subtasks;
}

async function runSubtask(subtask: Subtask): Promise<SubtaskResult> {
  // Real impl: publish to event bus, await worker response
  return { type: subtask.type, output: null };
}

export { decomposeAndRun };
