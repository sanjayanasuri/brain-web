import { NextRequest, NextResponse } from 'next/server';

function getOpenAIApiKey(): string | null {
  // Try environment variable first
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { title: null, error: 'OpenAI API key not configured' },
        { status: 500 }
      );
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

