export default class FixedSizeQueue<T> {
  public size: number
  public count: number

  private queue: (T | null)[]
  private front: number
  private rear: number

  constructor(size: number, ...initialElements: T[]) {
    this.size = size
    this.queue = new Array<T | null>(size).fill(null)
    this.front = 0
    this.rear = -1
    this.count = 0

    // Enqueue initial elements
    for (const element of initialElements) {
      this.enqueue(element)
    }
  }

  isFull(): boolean {
    return this.count === this.size
  }

  isEmpty(): boolean {
    return this.count === 0
  }

  reset(): void {
    throw new Error('Reset operation is not supported in FixedSizeQueue')
  }

  enqueue(...items: T[]): void {
    for (const item of items) {
      if (this.isFull()) {
        throw new Error('Queue is full')
      }
      this.rear = (this.rear + 1) % this.size
      this.queue[this.rear] = item
      this.count++
    }
  }

  // NOTE: doesn't supporting
  enqueueNoDuplicate(...items: T[]): void {
    for (const item of items) {
      if (this.isFull()) {
        throw new Error('Queue is full')
      }
      this.rear = (this.rear + 1) % this.size
      this.queue[this.rear] = item
      this.count++
    }
  }

  dequeue(): T {
    if (this.isEmpty()) {
      throw new Error('Queue is empty')
    }
    const item = this.queue[this.front]
    this.front = (this.front + 1) % this.size
    this.count--
    return item
  }

  evict(...items: T[]): void {
    throw new Error('Evict operation is not supported in FixedSizeQueue')
  }

  peek(): T | null {
    if (this.isEmpty()) {
      throw new Error('Queue is empty')
    }
    return this.queue[this.front]
  }

  peekAll(): T[] {
    if (this.isEmpty()) {
      return []
    }
    const items: T[] = []
    for (let i = 0; i < this.count; i++) {
      items.push(this.queue[(this.front + i) % this.size]!)
    }
    return items
  }
}
