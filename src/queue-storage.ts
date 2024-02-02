import { LocalStorage } from 'node-localstorage'
import { createHash } from 'crypto'

export default class DynamicSizeQueue<T> {
  public count: number = 0
  public tailKey: string

  // Linked list
  private storage: LocalStorage
  private rootKey = 'queue-storage-root-key'

  constructor(path: string, ...initialElements: T[]) {
    this.storage = new LocalStorage(path)
    this.loadInitalState()
    // Enqueue initial elements
    for (const element of initialElements) {
      this.enqueue(element as object)
    }
  }

  loadInitalState(): number {
    let key = this.rootKey
    let total = 0
    while (true) {
      const data = this.storage.getItem(key)
      if (data === null) {
        this.tailKey = key
        this.count = total
        return total
      }
      key = this.generateKey(JSON.parse(data))
      total++
    }
  }

  isEmpty(): boolean {
    return this.count === 0
  }

  reset(): void {
    this.storage.clear()
    this.count = 0
    this.tailKey = ''
  }

  enqueue<T extends object>(...items: T[]): void {
    for (const item of items) {
      const data = JSON.stringify(item)
      // set the root key if the queue is empty
      if (this.isEmpty() || this.tailKey === '') {
        this.storage.setItem(this.rootKey, data)
      } else {
        this.storage.setItem(this.tailKey, data)
      }
      // update the tail key
      this.tailKey = this.generateKey(item)
      // increment count
      this.count++
    }
  }

  dequeue(): T {
    if (this.isEmpty()) {
      throw new Error('Queue is empty')
    }
    // get the item from the root key
    const item = JSON.parse(this.storage.getItem(this.rootKey))
    // extract item
    const nextKey = this.generateKey(item)
    const nextItem = this.storage.getItem(nextKey)
    // store next item to root
    this.storage.setItem(this.rootKey, nextItem)
    // remove the old data
    this.storage.removeItem(nextKey)
    // decrement count
    this.count--
    return item
  }

  generateKey(data: object): string {
    // assign the txHash as the tail key if it exists
    // otherwise, use the sha256 hash of the data
    return 'txHash' in data
      ? (data['txHash'] as string)
      : this.sha256(JSON.stringify(data)) || ''
  }

  peek(): T | null {
    if (this.isEmpty()) {
      throw new Error('Queue is empty')
    }
    return JSON.parse(this.storage.getItem(this.rootKey))
  }

  sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex')
  }
}
