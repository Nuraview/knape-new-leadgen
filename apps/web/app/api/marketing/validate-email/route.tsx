import { NextRequest, NextResponse } from 'next/server';
import { validateEmail, validateEmails, EmailValidationResult } from '@/lib/marketing/email-validator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, emails } = body;

    // Single email validation
    if (email) {
      const result = await validateEmail(email);
      return NextResponse.json(result);
    }

    // Batch email validation
    if (emails && Array.isArray(emails)) {
      const results = await validateEmails(emails);
      return NextResponse.json({ results });
    }

    return NextResponse.json(
      { error: 'Please provide either "email" or "emails" array' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Email validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate email' },
      { status: 500 }
    );
  }
}
