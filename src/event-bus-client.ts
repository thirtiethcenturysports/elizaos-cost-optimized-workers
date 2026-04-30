// Event bus client
// Publish/subscribe for task routing

interface BusEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

type Handler = (payload: unknown) => Promise<void> | void;

class EventBusClient {
  private subscribers: Map<string, Handler[]> = new Map();

  subscribe(eventType: string, handler: Handler): void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType)!.push(handler);
  }

  async publish(event: BusEvent): Promise<void> {
    const handlers = this.subscribers.get(event.type) || [];
    for (const handler of handlers) {
      await handler(event.payload);
    }
  }
}

export default EventBusClient;
