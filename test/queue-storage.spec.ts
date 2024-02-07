import { expect } from 'chai'
import DynamicSizeQueue from '../src/queue-storage'
import { L2toL1Message } from '../src/finalize_worker'
import { BigNumber } from 'ethers'

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
        { txHash: '0x9' }
      )
      expect(queue.count).to.equal(9)
      expect(queue.tailKey).to.equal('0x9')

      // enqueue no duplicate
      queue.enqueueNoDuplicate(
        { txHash: '0x1' },
        { txHash: '0x10' },
        { txHash: '0x4' }
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

  describe('serialize/deserialize', function () {
    it('succeed', async function () {
      const queue = new DynamicSizeQueue<L2toL1Message>(queuePath)
      const message: L2toL1Message = {
        blockHeight: 1,
        txHash: '0x1',
        message: {
          direction: 1,
          logIndex: 1,
          blockNumber: 1,
          transactionHash: '0x',
          sender: 'sender',
          target: 'target',
          message: 'message',
          messageNonce: BigNumber.from('123'),
          value: BigNumber.from('1000000000000000000'),
          minGasLimit: BigNumber.from('3000000000'),
        },
      }

      const serialized = queue.serialize(message)
      const deserialized = queue.deserialize(serialized)

      expect(deserialized).to.deep.equal(message)
    })
  })
})
