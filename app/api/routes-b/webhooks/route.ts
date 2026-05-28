import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'

const SIGNATURE_HEADER = 'X-LancePay-Signature-256'

/**
 * Compute an HMAC-SHA256 signature over a JSON payload using the webhook's
 * signing secret. The result is prefixed with "sha256=" to match the GitHub
 * webhook signature convention.
 */
export function signWebhookPayload(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload, 'utf8')
  return `sha256=${hmac.digest('hex')}`
}

async function getAuthenticatedUser(request: NextRequest) {
  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!authToken) return null
  const claims = await verifyAuthToken(authToken)
  if (!claims) return null
  return prisma.user.findUnique({
    where: { privyId: claims.userId },
    select: { id: true },
  })
}

// GET /api/routes-b/webhooks — list registered webhooks
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const webhooks = await prisma.userWebhook.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      targetUrl: true,
      description: true,
      isActive: true,
      subscribedEvents: true,
      status: true,
      lastTriggeredAt: true,
      createdAt: true,
      // signingSecret intentionally excluded
    },
  })

  return NextResponse.json({ webhooks })
}

// POST /api/routes-b/webhooks — register a new webhook and return signed example
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  if (!body.targetUrl || typeof body.targetUrl !== 'string') {
    return NextResponse.json({ error: 'targetUrl is required' }, { status: 400 })
  }
  try {
    const parsed = new URL(body.targetUrl as string)
    if (parsed.protocol !== 'https:') throw new Error()
  } catch {
    return NextResponse.json(
      { error: 'targetUrl must be a valid https:// URL' },
      { status: 400 },
    )
  }

  const existingCount = await prisma.userWebhook.count({ where: { userId: user.id } })
  if (existingCount >= 10) {
    return NextResponse.json({ error: 'Maximum of 10 webhooks per user reached' }, { status: 429 })
  }

  const signingSecret = crypto.randomBytes(32).toString('hex')

  const webhook = await prisma.userWebhook.create({
    data: {
      userId: user.id,
      targetUrl: body.targetUrl as string,
      description: typeof body.description === 'string' ? body.description : null,
      signingSecret,
    },
    select: { id: true, targetUrl: true, description: true, createdAt: true },
  })

  // Provide a signed example payload so the caller can verify their listener
  const examplePayload = JSON.stringify({ event: 'webhook.registered', webhookId: webhook.id })
  const exampleSignature = signWebhookPayload(examplePayload, signingSecret)

  return NextResponse.json(
    {
      id: webhook.id,
      targetUrl: webhook.targetUrl,
      description: webhook.description ?? null,
      signingSecret,
      createdAt: webhook.createdAt,
      example: {
        payload: examplePayload,
        [SIGNATURE_HEADER]: exampleSignature,
      },
    },
    {
      status: 201,
      headers: { [SIGNATURE_HEADER]: exampleSignature },
    },
  )
}
