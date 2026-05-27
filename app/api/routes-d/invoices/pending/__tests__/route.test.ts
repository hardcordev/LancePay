import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

const verifyAuthToken = vi.fn()
const findUnique = vi.fn()
const findMany = vi.fn()

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique },
    invoice: { findMany },
  },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}))

const BASE_URL = 'http://localhost/api/routes-d/invoices/pending'

function makeRequest(query = '') {
  return new NextRequest(`${BASE_URL}${query}`, {
    headers: { authorization: 'Bearer token' },
  })
}

describe('GET /api/routes-d/invoices/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 for unauthenticated requests', async () => {
    verifyAuthToken.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 when user not found', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns pending invoices with default pagination', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    findMany.mockResolvedValue([
      {
        id: 'inv_1',
        invoiceNumber: 'INV-001',
        clientName: 'John Doe',
        clientEmail: 'john@example.com',
        amount: '100.00',
        currency: 'USD',
        dueDate: new Date('2026-06-01'),
        createdAt: new Date('2026-05-01'),
      },
    ])

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.data).toHaveLength(1)
    expect(data.data[0].amount).toBe(100)
    expect(data.nextCursor).toBeNull()

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', status: 'pending' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      select: {
        id: true,
        invoiceNumber: true,
        clientName: true,
        clientEmail: true,
        amount: true,
        currency: true,
        dueDate: true,
        createdAt: true,
      },
    })
  })

  it('applies cursor pagination', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    findMany.mockResolvedValue([])

    await GET(makeRequest('?cursor=inv_123'))

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', status: 'pending', id: { lt: 'inv_123' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      select: {
        id: true,
        invoiceNumber: true,
        clientName: true,
        clientEmail: true,
        amount: true,
        currency: true,
        dueDate: true,
        createdAt: true,
      },
    })
  })

  it('respects limit parameter with max constraint', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    findMany.mockResolvedValue([])

    await GET(makeRequest('?limit=100'))

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 }) // 50 + 1 for hasNext check
    )
  })

  it('handles next cursor when more results available', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    
    // Return 21 items (limit + 1) to simulate more results
    const invoices = Array.from({ length: 21 }, (_, i) => ({
      id: `inv_${i}`,
      invoiceNumber: `INV-${i.toString().padStart(3, '0')}`,
      clientName: 'John Doe',
      clientEmail: 'john@example.com',
      amount: '100.00',
      currency: 'USD',
      dueDate: new Date('2026-06-01'),
      createdAt: new Date('2026-05-01'),
    }))
    findMany.mockResolvedValue(invoices)

    const res = await GET(makeRequest())
    const data = await res.json()
    
    expect(data.data).toHaveLength(20) // Should return only limit items
    expect(data.nextCursor).toBe('inv_19') // Last item's ID
  })

  it('returns 500 on database error', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    findMany.mockRejectedValue(new Error('Database error'))

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })
})