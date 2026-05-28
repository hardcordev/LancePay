import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { RouteRateLimiter, buildRateLimitResponse } from '@/lib/rate-limit'

const markAllReadLimiter = new RouteRateLimiter({
  id: 'notifications-mark-all-read',
  maxRequests: 10,
  windowMs: 60_000, // 10 per minute per user
})

export async function POST(request: NextRequest) {
  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = markAllReadLimiter.check(claims.userId)
  if (!rl.allowed) {
    return buildRateLimitResponse(rl)
  }

  const user = await prisma.user.findUnique({
    where: { privyId: claims.userId },
  })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const result = await prisma.notification.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true },
  })

  return NextResponse.json(
    { success: true, updatedCount: result.count },
    {
      headers: {
        'X-RateLimit-Limit': rl.limit.toString(),
        'X-RateLimit-Remaining': rl.remaining.toString(),
        'X-RateLimit-Reset': rl.resetAt.toString(),
      },
    },
  )
}
