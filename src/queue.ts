export default class Queue<T> {
  private elements: Array<T | undefined>
  private size: number

  constructor(length: number = 1024, ...elements: T[]) {
    // allocate memory for the queue
    this.elements = new Array<T | undefined>(length).fill(undefined)
    this.elements.splice(0, elements.length, ...elements)
    this.size = elements.length
  }

  push(...args: T[]): number {
    this.size += args.length
    return this.elements.push(...args)
  }

  shift(): T | undefined {
    this.size--
    return this.elements.shift()
  }

  getLength(): number {
    return this.elements.length
  }

  getSize(): number {
    return this.size
  }

  head(): T | undefined {
    return this.elements[0]
  }

  setLength(length: number) {
    if (length < this.elements.length) {
      this.elements.length = length // shorten the array
    } else {
      // extend the array filling it with undefined values
      for (let i = this.elements.length; i < length; i++) {
        this.elements.push(undefined)
      }
    }
  }
}
