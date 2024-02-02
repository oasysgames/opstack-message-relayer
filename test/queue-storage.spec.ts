import { expect } from 'chai'
import DynamicSizeQueue from '../src/queue-storage'

export type TestMessage = {
  txHash: string
}

const queuePath = './.queuestoretest'

describe('FixedSizeQueue', function () {
  async function setup() {
    const queue = new DynamicSizeQueue<TestMessage>(
      queuePath,
      { txHash: '0x1' },
      { txHash: '0x2' },
      { txHash: '0x3' },
      { txHash: '0x4' },
      { txHash: '0x5' }
    )
    return { queue }
  }

  describe('push/shift', function () {
    it('succeed', async function () {
      const { queue } = await setup()

      // inital state
      expect(queue.count).to.equal(5)
      expect(queue.isEmpty()).to.false
      expect(queue.tailKey).to.equal('0x5')

      // enqueue lower than limit
      queue.enqueue(
        { txHash: '0x6' },
        { txHash: '0x7' },
        { txHash: '0x8' },
        { txHash: '0x9' },
        { txHash: '0x10' }
      )
      expect(queue.count).to.equal(10)
      expect(queue.tailKey).to.equal('0x10')

      // dequeue
      const count = queue.count
      for (let i = 0; i < count; i++) {
        expect(queue.peek()?.txHash).to.equal(`0x${i + 1}`)
        expect(queue.dequeue()?.txHash).to.equal(`0x${i + 1}`)
        expect(queue.count).to.equal(count - i - 1)
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

      // enqueue again
      queue.enqueue({ txHash: '0x11' }, { txHash: '0x12' }, { txHash: '0x13' })
      expect(queue.count).to.equal(3)

      // dequeue again
      expect(queue.dequeue()?.txHash).to.equal('0x11')
      expect(queue.count).to.equal(2)
      expect(queue.peek()?.txHash).to.equal('0x12')

      queue.reset()
      expect(queue.count).to.equal(0)
    })
  })

  describe('reload', function () {
    it('succeed', async function () {
      let { queue } = await setup()

      // reload
      queue = new DynamicSizeQueue<TestMessage>(queuePath)

      expect(queue.count).to.equal(5)
      expect(queue.isEmpty()).to.false
      expect(queue.tailKey).to.equal('0x5')

      queue.reset()
    })
  })
})
