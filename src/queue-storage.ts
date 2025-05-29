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
    if (path === '') {
      throw new Error(
        '[DynamicSizeQueue] path is empty, please provide a valid path for queue storage'
      )
    }
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
      this.tailKey = ''
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

  evict(...items: T[]): void {
    if (items.length === 0) return

    let i = 0 // index for items
    while (i < items.length) {
      const itemKey = this._findItemKey(items[i])
      const keyPointTo = this._generateKey(items[i])

      // fetch the next item on memory, then delete it from storage
      let nextItem = this.deserialize(this.storage.getItem(keyPointTo))
      if (nextItem !== null) {
        this.storage.removeItem(keyPointTo)
        this.count--
      }

      // go to the next item
      i++

      // Evic sequential items
      while (nextItem !== null && i < items.length) {
        const keyPointTo2 = this._generateKey(items[i])
        const keyOfNextItem = this._generateKey(nextItem)
        if (keyPointTo2 !== keyOfNextItem) {
          // exit if the next index of item is not the next itme in the queue
          break
        }

        // fetch the next item on memory, then delete it from storage
        nextItem = this.deserialize(this.storage.getItem(keyPointTo2))
        if (nextItem !== null) {
          this.storage.removeItem(keyPointTo2)
          this.count--
        }

        // go to the next item
        i++
      }

      // update tail
      if (nextItem === null) {
        if (itemKey === this.rootKey) {
          this.tailKey = ''
        } else {
          this.tailKey = itemKey
        }
        this.storage.removeItem(itemKey)
        this.count--
        break
      }

      // overwrite the evicted item with the next item
      this.storage.setItem(itemKey, this.serialize(nextItem))
    }

    // santity check
    if (i !== items.length) {
      throw new Error('Not all items were evicted from the queue')
    }
  }

  peek(): T {
    if (this.isEmpty()) {
      throw new Error('Queue is empty')
    }
    return this.deserialize(this.storage.getItem(this.rootKey))
  }

  peekAll(): T[] {
    const items: T[] = []
    let key = this.rootKey
    while (true) {
      const data = this.storage.getItem(key)
      if (data === null) {
        break
      }
      items.push(this.deserialize(data))
      key = this._generateKey(this.deserialize(data))
    }
    return items
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

  private _findItemKey(item: T): string {
    const nextKey = this._generateKey(item)
    let itemKey = this.rootKey
    for (let i = 0; i < this.count; i++) {
      const data = this.storage.getItem(itemKey)
      if (data === null) {
        throw new Error('Item not found in queue')
      }
      const item = this.deserialize(data)
      if (this._generateKey(item) === nextKey) {
        break
      }
      itemKey = this._generateKey(item)
    }
    return itemKey
  }

  private _has(item: T): boolean {
    const key = this._generateKey(item)
    return this.storage.getItem(key) !== null || key === this.tailKey
  }

  private _sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex')
  }
}
