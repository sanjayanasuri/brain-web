import { NextRequest, NextResponse } from 'next/server';

function getOpenAIApiKey(): string | undefined {
  // Try to read directly from .env.local file as a fallback
  // Priority: 1) process.env, 2) repo root .env.local (matches backend), 3) frontend/.env.local
  let key = process.env.OPENAI_API_KEY;
  
  // If key is too short or missing, try reading from file directly
  if (!key || key.length < 20) {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // First try repo root .env.local (same as backend uses)
      const repoRootEnvPath = path.join(process.cwd(), '..', '.env.local');
      if (fs.existsSync(repoRootEnvPath)) {
        const content = fs.readFileSync(repoRootEnvPath, 'utf8');
        const match = content.match(/^OPENAI_API_KEY=(.+)$/m);
        if (match && match[1]) {
          key = match[1].trim();
          console.log('[Title API] Read API key from repo root .env.local (matches backend)');
        }
      }
      
      // Fallback to frontend/.env.local if repo root doesn't have it
      if (!key || key.length < 20) {
        const frontendEnvPath = path.join(process.cwd(), '.env.local');
        if (fs.existsSync(frontendEnvPath)) {
          const content = fs.readFileSync(frontendEnvPath, 'utf8');
          const match = content.match(/^OPENAI_API_KEY=(.+)$/m);
          if (match && match[1]) {
            key = match[1].trim();
            console.log('[Title API] Read API key from frontend/.env.local');
          }
        }
      }
    } catch (err) {
      console.warn('[Title API] Could not read .env.local directly:', err);
    }
  }
  
  if (!key) {
    console.error('[Title API] OPENAI_API_KEY not found in environment variables');
    return undefined;
  }
  
  // Trim any whitespace that might have been introduced
  const trimmedKey = key.trim();
  
  if (trimmedKey.length < 20) {
    console.error(`[Title API] ERROR: API key is too short (${trimmedKey.length} chars). Expected ~164 chars.`);
  } else {
    console.log(`[Title API] ✓ OpenAI API key loaded (length: ${trimmedKey.length})`);
  }
  
  return trimmedKey;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      // Fallback to truncating the question instead of erroring
      const body = await request.json().catch(() => ({}));
      const question = body.question || 'New Conversation';
      return NextResponse.json({
        title: question.length > 50 ? question.substring(0, 47) + '...' : question,
      });
    }

    const body = await request.json();
    const { question } = body;

    if (!question || typeof question !== 'string') {
      return NextResponse.json(
        { title: null, error: 'Question is required' },
        { status: 400 }
      );
    }

    // Generate a concise title from the question
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates concise, descriptive titles for chat conversations based on the first question asked. Return only the title, no quotes or extra text. Keep it under 50 characters and make it descriptive of the topic.',
          },
          {
            role: 'user',
            content: `Generate a title for a conversation that starts with this question: "${question}"`,
          },
        ],
        max_tokens: 20,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      // Fallback to truncating the question
      return NextResponse.json({
        title: question.length > 50 ? question.substring(0, 47) + '...' : question,
      });
    }

    const data = await response.json();
    const title = data.choices?.[0]?.message?.content?.trim() || 
                  (question.length > 50 ? question.substring(0, 47) + '...' : question);

    return NextResponse.json({ title });
  } catch (error) {
    console.error('Title generation error:', error);
    // Fallback: return truncated question
    const body = await request.json().catch(() => ({}));
    const question = body.question || 'New Conversation';
    return NextResponse.json({
      title: question.length > 50 ? question.substring(0, 47) + '...' : question,
    });
  }
}

