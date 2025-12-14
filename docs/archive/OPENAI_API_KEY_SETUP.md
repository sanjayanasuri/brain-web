# OpenAI API Key Setup Guide

## Overview

Both the **backend** and **frontend** need the OpenAI API key to function properly:

- **Backend**: Uses the key for semantic search (embeddings)
- **Frontend**: Uses the key for chat completions (GPT-4o-mini)

## File Locations and Format

### Backend (`backend/.env`)

**Location**: `/Users/sanjayanasuri/brain-web/backend/.env`

**Format**:
```
OPENAI_API_KEY=sk-proj-...your-key-here...
```

**Important**:
- No quotes needed around the value
- No spaces around the `=` sign
- The key should be on a single line (no line breaks)
- The key should start with `sk-` and be ~164 characters long

### Frontend (`frontend/.env.local`)

**Location**: `/Users/sanjayanasuri/brain-web/frontend/.env.local`

**Format**:
```
# OpenAI API Key for Brain Web chat functionality
# Get your API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-...your-key-here...
```

**Important**:
- Next.js requires server-side env vars to **NOT** have `NEXT_PUBLIC_` prefix
- Use `.env.local` (not `.env` or `.env.local.public`)
- No quotes needed
- No spaces around `=`
- Single line only

## How Each Component Loads the Key

### Backend (`backend/services_search.py`)

The backend tries three methods in order:

1. **Direct file read**: Reads `backend/.env` file directly
2. **Environment variable**: Uses `os.getenv("OPENAI_API_KEY")` after `load_dotenv()`
3. **Config module**: Imports from `config.py` which also loads `.env`

**Verification**:
```bash
cd backend
python3 -c "from services_search import client; print(f'Client initialized: {client is not None}')"
```

Expected output:
```
✓ OpenAI API key loaded (length: 164, starts with: sk-proj-2H...)
✓ OpenAI client initialized successfully
Client initialized: True
```

### Frontend (`frontend/app/api/brain-web/chat/route.ts`)

The frontend loads the key via Next.js environment variables:

```typescript
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
```

**Verification**:
- Check the Next.js dev server console for:
  ```
  [Chat API] OpenAI API key loaded (length: 164)
  ```

## Common Issues and Fixes

### Issue: "API key not found" or "Client not initialized"

**Backend**:
1. Check that `backend/.env` exists and contains `OPENAI_API_KEY=...`
2. Ensure no quotes around the value
3. Ensure no line breaks in the key
4. Restart the backend server

**Frontend**:
1. Check that `frontend/.env.local` exists (not `.env`)
2. Ensure the key doesn't have `NEXT_PUBLIC_` prefix
3. Restart the Next.js dev server (`npm run dev`)

### Issue: "Invalid API key" error

1. Verify the key is correct at https://platform.openai.com/api-keys
2. Check that the key hasn't been rotated/revoked
3. Ensure the full key is copied (should be ~164 characters)
4. Check for any hidden characters or whitespace

### Issue: Key appears truncated (length < 100)

This usually means:
- The key has a line break in the middle
- The `.env` file has special characters
- The key wasn't copied completely

**Fix**: Re-copy the key and ensure it's on a single line with no breaks.

## Testing

### Test Backend Semantic Search

```bash
cd backend
curl -X POST http://127.0.0.1:8000/ai/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"message": "test", "limit": 5}'
```

Should return nodes with non-zero scores if the key is working.

### Test Frontend Chat API

```bash
curl -X POST http://localhost:3000/api/brain-web/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is software architecture?"}'
```

Should return a chat response if the key is working.

## Current Status

✅ **Backend**: Key loaded successfully (164 chars)
✅ **Frontend**: Key should be in `.env.local`

Both components now have:
- Better error messages
- Key validation (length, format)
- Multiple fallback methods for loading
- Detailed logging for debugging

