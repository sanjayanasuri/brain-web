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
          }
        }
      }
    } catch (err) {
      console.warn('[Description API] Could not read .env.local directly:', err);
    }
  }
  
  return key?.trim();
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { description: null, error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { conceptName, domain, type, context } = body;

    if (!conceptName || typeof conceptName !== 'string') {
      return NextResponse.json(
        { description: null, error: 'Concept name is required' },
        { status: 400 }
      );
    }

    // Build context for better description generation
    let contextText = '';
    if (context) {
      if (context.neighbors && context.neighbors.length > 0) {
        const neighborNames = context.neighbors.slice(0, 5).map((n: any) => n.name).join(', ');
        contextText += `Related concepts: ${neighborNames}. `;
      }
      if (context.claims && context.claims.length > 0) {
        const claimTexts = context.claims.slice(0, 3).map((c: any) => c.text).join('; ');
        contextText += `Known facts: ${claimTexts}. `;
      }
    }

    // Generate a description using LLM
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
            content: 'You are a helpful assistant that generates concise, informative descriptions for concepts in a knowledge graph. Write 2-3 sentences that explain what the concept is, its key characteristics, and why it matters. Be clear and educational.',
          },
          {
            role: 'user',
            content: `Generate a description for the concept "${conceptName}"${domain ? ` in the domain of ${domain}` : ''}${type ? ` (type: ${type})` : ''}.${contextText ? `\n\nContext: ${contextText}` : ''}\n\nWrite a clear, informative 2-3 sentence description.`,
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      return NextResponse.json({
        description: null,
        error: 'Failed to generate description',
      });
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim() || null;

    return NextResponse.json({ description });
  } catch (error) {
    console.error('Description generation error:', error);
    return NextResponse.json({
      description: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

