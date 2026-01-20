import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

/**
 * API route to generate a dev authentication token for backend API requests.
 * This is a server-side route that can safely use the JWT secret.
 */
export async function GET() {
  try {
    // Use the same default secret as backend/auth.py for local dev
    const secret = process.env.API_TOKEN_SECRET || 'dev-secret-key-change-in-production';
    
    // Generate a token with default user/tenant for local dev
    const payload = {
      user_id: 'dev-user',
      tenant_id: 'dev-tenant',
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days
      iat: Math.floor(Date.now() / 1000),
    };
    
    const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
    
    return NextResponse.json({ token });
  } catch (error) {
    console.error('[Auth Token API] Error generating token:', error);
    return NextResponse.json(
      { error: 'Failed to generate authentication token' },
      { status: 500 }
    );
  }
}
