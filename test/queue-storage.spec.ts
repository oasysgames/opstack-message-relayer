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
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x1',
        '0x2',
        '0x3',
        '0x4',
        '0x5',
        '0x6',
        '0x7',
        '0x8',
        '0x9',
      ])

      // enqueue no duplicate
      queue.enqueueNoDuplicate(
        { txHash: '0x1' },
        { txHash: '0x9' },
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

  describe('evict', function () {
    let queue: DynamicSizeQueue<TestMessage>
    beforeEach(async function () {
      const obj = await setup()
      queue = obj.queue
    })
    afterEach(function () {
      queue.reset()
    })

    it('middle | sequence', async function () {
      queue.evict({ txHash: '0x2' }, { txHash: '0x3' })

      expect(queue.count).to.equal(3)
      expect(queue.tailKey).to.equal('0x5')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x1',
        '0x4',
        '0x5',
      ])
      for (let i = 0; i < 3; i++) {
        queue.dequeue()
      }
      expect(queue.count).to.equal(0)
      expect(queue.tailKey).to.equal('')
    })

    it('head | sequence', async function () {
      queue.evict({ txHash: '0x1' }, { txHash: '0x2' })

      expect(queue.count).to.equal(3)
      expect(queue.tailKey).to.equal('0x5')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x3',
        '0x4',
        '0x5',
      ])
      for (let i = 0; i < 3; i++) {
        queue.dequeue()
      }
      expect(queue.count).to.equal(0)
      expect(queue.tailKey).to.equal('')
    })

    it('tail | sequence', async function () {
      queue.evict({ txHash: '0x4' }, { txHash: '0x5' })

      expect(queue.count).to.equal(3)
      expect(queue.tailKey).to.equal('0x3')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x1',
        '0x2',
        '0x3',
      ])
      for (let i = 0; i < 3; i++) {
        queue.dequeue()
      }
      expect(queue.count).to.equal(0)
      expect(queue.tailKey).to.equal('')
    })

    it('middle | not sequence', async function () {
      queue.evict({ txHash: '0x2' }, { txHash: '0x4' })

      expect(queue.count).to.equal(3)
      expect(queue.tailKey).to.equal('0x5')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x1',
        '0x3',
        '0x5',
      ])
      for (let i = 0; i < 3; i++) {
        queue.dequeue()
      }
      expect(queue.count).to.equal(0)
      expect(queue.tailKey).to.equal('')
    })

    it('head and tail | not sequence', async function () {
      queue.evict({ txHash: '0x1' }, { txHash: '0x5' })

      expect(queue.count).to.equal(3)
      expect(queue.tailKey).to.equal('0x4')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x2',
        '0x3',
        '0x4',
      ])
      for (let i = 0; i < 3; i++) {
        queue.dequeue()
      }
      expect(queue.count).to.equal(0)
      expect(queue.tailKey).to.equal('')
    })

    it('all', async function () {
      queue.evict(
        { txHash: '0x1' },
        { txHash: '0x2' },
        { txHash: '0x3' },
        { txHash: '0x4' },
        { txHash: '0x5' }
      )

      expect(queue.count).to.equal(0)
      expect(queue.tailKey).to.equal('')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([])
    })

    it('inorder | partial', async function () {
      queue.evict({ txHash: '0x4' }, { txHash: '0x5' }, { txHash: '0x1' })
      expect(queue.count).to.equal(2)
      expect(queue.tailKey).to.equal('0x3')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x2',
        '0x3',
      ])
    })

    it('inorder | all', async function () {
      queue.evict(
        { txHash: '0x2' },
        { txHash: '0x4' },
        { txHash: '0x5' },
        { txHash: '0x1' },
        { txHash: '0x3' }
      )
      expect(queue.count).to.equal(0)
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([])
      expect(queue.tailKey).to.equal('')
    })

    it('dupplicate', async function () {
      queue.evict(
        { txHash: '0x5' },
        { txHash: '0x3' },
        { txHash: '0x5' },
        { txHash: '0x1' },
        { txHash: '0x3' },
        { txHash: '0x1' },
        { txHash: '0x5' }
      )

      expect(queue.count).to.equal(2)
      expect(queue.tailKey).to.equal('0x4')
      expect(queue.peekAll().map((msg) => msg.txHash)).to.deep.equal([
        '0x2',
        '0x4',
      ])
    })

    it('evit not exist | err', function () {
      try {
        queue.evict({ txHash: '0x6' })
        throw new Error('Should not reach here')
      } catch (e: any) {
        const expectedMessage = 'Item not found in queue'
        expect(e.message.substr(0, expectedMessage.length)).to.equal(
          expectedMessage
        )
      }

      try {
        queue.evict(
          { txHash: '0x4' },
          { txHash: '0x5' },
          { txHash: '0x6' },
          { txHash: '0x3' }
        )
        throw new Error('Should not reach here')
      } catch (e: any) {
        const expectedMessage = 'Item not found in queue'
        expect(e.message.substr(0, expectedMessage.length)).to.equal(
          expectedMessage
        )
      }

      expect(queue.count).to.equal(3)
      expect(queue.tailKey).to.equal('0x3')
    })

    it('evit not exist | no err', function () {
      try {
        queue.evictIgnoreNotFound({ txHash: '0x6' })
        throw new Error('Should reach here')
      } catch (e: any) {
        expect(e.message).to.equal('Should reach here')
      }

      try {
        queue.evictIgnoreNotFound(
          { txHash: '0x4' },
          { txHash: '0x5' },
          { txHash: '0x6' },
          { txHash: '0x3' }
        )
        throw new Error('Should reach here')
      } catch (e: any) {
        expect(e.message).to.equal('Should reach here')
      }
      expect(queue.count).to.equal(2)
      expect(queue.tailKey).to.equal('0x2')
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
