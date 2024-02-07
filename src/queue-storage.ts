import { LocalStorage } from 'node-localstorage'
import { createHash } from 'crypto'
import { BigNumber } from 'ethers'

// The queue design is linked list
export default class DynamicSizeQueue<T> {
  public count: number = 0
  public tailKey: string
  public storage: LocalStorage

  private rootKey = 'queue-storage-root-key'

  constructor(path: string, ...initialElements: T[]) {
    this.storage = new LocalStorage(path)
    this._loadInitalState()
    // Enqueue initial elements
    for (const element of initialElements) {
      this.enqueue(element)
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

  enqueue(...items: T[]): void {
    for (const item of items) {
      this._enqueue(item)
    }
  }

  enqueueNoDuplicate(...items: T[]): void {
    for (const item of items) {
      if (this._has(item)) {
        continue
      }
      this._enqueue(item)
    }
  }

  dequeue(): T {
    if (this.isEmpty()) {
      throw new Error('Queue is empty')
    }
    // get the item from the root key
    const item = this.deserialize(this.storage.getItem(this.rootKey))
    // extract item
    const nextKey = this._generateKey(item)
    const nextItem = this.storage.getItem(nextKey)
    if (nextItem === null) {
      // delete the root key if the queue is empty
      this.storage.removeItem(this.rootKey)
    } else {
      // store next item to root
      this.storage.setItem(this.rootKey, nextItem)
    }
    // remove the old data
    this.storage.removeItem(nextKey)
    // decrement count
    this.count--
    return item
  }

  peek(): T {
    if (this.isEmpty()) {
      throw new Error('Queue is empty')
    }
    return this.deserialize(this.storage.getItem(this.rootKey))
  }

  serialize(item: T): string {
    return JSON.stringify(item, (key, value) => {
      if (
        BigNumber.isBigNumber(value) ||
        (value.type && value.type === 'BigNumber')
      ) {
        return value.hex ? value.hex : value._hex
      } else {
        return value
      }
    })
  }

  deserialize(data: string): T {
    return JSON.parse(data, (key, value) => {
      if (
        value &&
        (key === 'messageNonce' || key === 'minGasLimit' || key === 'value')
      ) {
        return BigNumber.from(value)
      } else {
        return value
      }
    })
  }

  private _loadInitalState(): number {
    let key = this.rootKey
    let total = 0
    while (true) {
      const data = this.storage.getItem(key)
      if (data === null) {
        this.tailKey = key
        this.count = total
        return total
      }
      key = this._generateKey(this.deserialize(data))
      total++
    }
  }

  private _generateKey(data: T): string {
    // assign the txHash as the tail key if it exists
    // otherwise, use the sha256 hash of the data
    return 'txHash' in (data as object)
      ? (data['txHash'] as string)
      : this._sha256(this.serialize(data)) || ''
  }

  private _enqueue(item: T): void {
    const data = this.serialize(item)
    if (this.isEmpty() || this.tailKey === '') {
      // set the root key if the queue is empty
      this.storage.setItem(this.rootKey, data)
    } else {
      // append the data to the tail key
      this.storage.setItem(this.tailKey, data)
    }
    // update the tail key
    this.tailKey = this._generateKey(item)
    // increment count
    this.count++
  }

  private _has(item: T): boolean {
    const key = this._generateKey(item)
    return this.storage.getItem(key) !== null || key === this.tailKey
  }

  private _sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex')
  }
}
