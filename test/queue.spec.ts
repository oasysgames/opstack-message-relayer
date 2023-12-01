import { expect } from 'chai'
import FixedSizeQueue  from '../src/queue'

describe('FixedSizeQueue', function () {
  const limit = 10

  async function setup() {
    const queue = new FixedSizeQueue<number>(limit, 1, 2, 3, 4, 5)
    return { queue }
  }

  describe('push/shift', function () {
    it('succeed', async function () {
      const { queue } = await setup()

      // inital state
      expect(queue.size).to.equal(limit)
      expect(queue.count).to.equal(5)
      expect(queue.isFull()).to.false
      expect(queue.isEmpty()).to.false

      // enqueue lower than limit
      queue.enqueue(6, 7, 8, 9, 10)
      expect(queue.count).to.equal(10)
      expect(queue.isFull()).to.true

      // enqueue more than limit, throw error with message
      try {
        queue.enqueue(11)
      } catch (e) {
        expect(e.message).to.eq('Queue is full')
      }

      // dequeue
      for (let i = 0; i < queue.size; i++) {
        expect(queue.peek()).to.equal(i+1)
        expect(queue.dequeue()).to.equal(i+1)
        expect(queue.count).to.equal(queue.size - i - 1)
      }

      // dequeue empty queue, throw error with message
      expect(queue.isEmpty()).to.true
      expect(queue.count).to.equal(0)
      try {
        queue.dequeue()
      } catch (e) {
        expect(e.message).to.eq('Queue is empty')
      }

      // peak empty queue, throw error with message
      try {
        queue.peek()
      } catch (e) {
        expect(e.message).to.eq('Queue is empty')
      }
    })
  })
})
