import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyAuthToken = vi.fn()
const userFindUnique = vi.fn()
const invoiceFindUnique = vi.fn()
const invoiceUpdate = vi.fn()
const loggerError = vi.fn()

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    invoice: {
      findUnique: invoiceFindUnique,
      update: invoiceUpdate,
    },
  },
}))

const URL = 'http://localhost/api/routes-d/invoices/inv_1/description'

function makeRequest(body: unknown, headers: Record<string, string> = { authorization: 'Bearer token' }) {
  return new NextRequest(URL, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/routes-d/invoices/[id]/description', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    verifyAuthToken.mockResolvedValue(null)

    const { PATCH } = await import('@/app/api/routes-d/invoices/[id]/description/route')
    const response = await PATCH(makeRequest({ description: 'Updated' }), {
      params: Promise.resolve({ id: 'inv_1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('returns 400 for an empty description', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })

    const { PATCH } = await import('@/app/api/routes-d/invoices/[id]/description/route')
    const response = await PATCH(makeRequest({ description: '   ' }), {
      params: Promise.resolve({ id: 'inv_1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Description is required and must be a non-empty string',
    })
    expect(invoiceFindUnique).not.toHaveBeenCalled()
  })

  it('returns 403 when the invoice belongs to another user', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    invoiceFindUnique.mockResolvedValue({ id: 'inv_1', userId: 'user_2', status: 'pending' })

    const { PATCH } = await import('@/app/api/routes-d/invoices/[id]/description/route')
    const response = await PATCH(makeRequest({ description: 'Updated' }), {
      params: Promise.resolve({ id: 'inv_1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(invoiceUpdate).not.toHaveBeenCalled()
  })

  it('returns 422 when the invoice is not pending', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    invoiceFindUnique.mockResolvedValue({ id: 'inv_1', userId: 'user_1', status: 'paid' })

    const { PATCH } = await import('@/app/api/routes-d/invoices/[id]/description/route')
    const response = await PATCH(makeRequest({ description: 'Updated' }), {
      params: Promise.resolve({ id: 'inv_1' }),
    })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'Only pending invoices can be updated' })
    expect(invoiceUpdate).not.toHaveBeenCalled()
  })

  it('updates the invoice description for the owner', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z')
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    invoiceFindUnique.mockResolvedValue({ id: 'inv_1', userId: 'user_1', status: 'pending' })
    invoiceUpdate.mockResolvedValue({
      id: 'inv_1',
      invoiceNumber: 'INV-001',
      description: 'Updated',
      updatedAt,
    })

    const { PATCH } = await import('@/app/api/routes-d/invoices/[id]/description/route')
    const response = await PATCH(makeRequest({ description: ' Updated ' }), {
      params: Promise.resolve({ id: 'inv_1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: 'inv_1',
      invoiceNumber: 'INV-001',
      description: 'Updated',
      updatedAt: updatedAt.toISOString(),
    })
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { description: 'Updated' },
      select: {
        id: true,
        invoiceNumber: true,
        description: true,
        updatedAt: true,
      },
    })
  })
})
