# Demo Strategy for Portfolio Website

## Your Questions Answered

### Q: Can users test Brain Web on my portfolio without entering their own API keys?

**A: Yes!** You can set up a demo mode where:
- Users don't need to enter any API keys
- Your backend uses your API keys (with rate limiting)
- Each demo session gets an isolated graph instance
- Users can't see your personal data

### Q: Should users see my personal information?

**A: No!** Demo mode uses:
- **Separate Neo4j database** (or namespace isolation)
- **Pre-seeded demo data** (sample concepts, not your personal data)
- **Session isolation** (each demo user gets their own temporary graph)

### Q: How will the demo work?

**A: Demo Flow:**
1. User clicks "Try Demo" on your portfolio
2. System creates a temporary demo session (30 min timeout)
3. User gets isolated graph with pre-seeded demo data
4. User can explore graph, ask questions (limited to 10-20 queries)
5. Session expires automatically
6. Option to sign up for full version

### Q: What about API costs?

**A: Estimated Costs:**
- **Per demo session**: ~$0.02 (with 20 queries)
- **100 sessions/day**: ~$2/day
- **1000 sessions/month**: ~$60/month

**Cost Control:**
- Set OpenAI usage limits in your account
- Rate limit queries per session
- Use cheaper models (GPT-4o-mini) for demo
- Monitor costs via OpenAI dashboard

## Recommended Demo Implementation

### Architecture

```
┌─────────────────────────────────────────┐
│         Your Portfolio Website          │
│  [Try Brain Web Demo] button            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Brain Web Demo Frontend            │
│  (Next.js app with demo mode enabled)   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Brain Web Backend                  │
│  (FastAPI with demo endpoints)          │
│  Uses YOUR API keys (rate limited)      │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌─────────────┐  ┌─────────────┐
│ Production  │  │ Demo        │
│ Database    │  │ Database    │
│ (Your Data) │  │ (Isolated)   │
└─────────────┘  └─────────────┘
```

### Key Features

1. **Session Management**
   - Each demo user gets unique session ID
   - Sessions expire after 30 minutes
   - Limited to 20 queries per session

2. **Data Isolation**
   - Separate Neo4j database for demos
   - Pre-seeded with interesting sample data
   - No access to your personal graph

3. **Rate Limiting**
   - Query limits per session
   - Timeout after inactivity
   - Prevents abuse

4. **Demo Data**
   - Sample concepts: "Machine Learning", "Neural Networks", "Backpropagation"
   - Sample relationships showing connections
   - Sample lecture content demonstrating features

## Implementation Steps

### Phase 1: Backend Demo Support (1-2 days)

1. **Create Demo Session Management**
   - Session creation endpoint
   - Session validation middleware
   - Query counting and limits

2. **Add Demo Database**
   - Create separate Neo4j database
   - Seed with demo data
   - Configure database switching

3. **Add Rate Limiting**
   - Query limit per session
   - Session expiration
   - Error handling for limits

### Phase 2: Frontend Demo Mode (1-2 days)

1. **Create Demo Route**
   - `/demo` page with demo-specific UI
   - Session management in frontend
   - Query counter display

2. **Modify API Client**
   - Demo mode detection
   - Session ID handling
   - Demo endpoint routing

3. **Demo Landing Page**
   - Welcome message
   - Feature showcase
   - "Start Demo" button

### Phase 3: Demo Data & Testing (1 day)

1. **Seed Demo Data**
   - Create interesting sample concepts
   - Add sample relationships
   - Include sample lecture content

2. **End-to-End Testing**
   - Test session creation
   - Test query limits
   - Test session expiration
   - Test data isolation

### Phase 4: Deployment (1 day)

1. **Deploy Backend**
   - Configure demo mode
   - Set up demo database
   - Configure rate limits

2. **Deploy Frontend**
   - Enable demo mode
   - Configure API URLs
   - Test on staging

3. **Add to Portfolio**
   - Add "Try Demo" button
   - Link to demo URL
   - Monitor usage

## Demo User Experience

### What Users Will See

1. **Demo Landing Page**
   ```
   Welcome to Brain Web Demo!
   
   Explore an interactive knowledge graph with AI-powered chat.
   Try asking questions, exploring concepts, and creating relationships.
   
   [Start Demo] button
   ```

2. **Demo Graph View**
   - Pre-seeded graph with sample concepts
   - Chat interface (limited queries)
   - Concept board access
   - Query counter: "15 queries remaining"

3. **Demo Limitations**
   - 20 queries per session
   - 30-minute session timeout
   - Read-only demo data (can't persist changes)
   - Limited features (no Notion sync, no file uploads)

4. **Session Expiration**
   ```
   Your demo session has expired.
   [Start New Demo] or [Sign Up for Full Version]
   ```

## Security Considerations

### Data Privacy
- ✅ Complete isolation from your data
- ✅ Demo sessions can't access production database
- ✅ No personal information in demo data
- ✅ Sessions auto-expire

### API Security
- ✅ Rate limiting prevents abuse
- ✅ Session validation on every request
- ✅ Input validation and sanitization
- ✅ Error messages don't leak sensitive info

### Cost Protection
- ✅ Query limits per session
- ✅ OpenAI usage limits in account
- ✅ Monitoring and alerts
- ✅ Automatic session cleanup

## Monitoring & Analytics

### Key Metrics
- Demo sessions created
- Queries per session
- Session completion rate
- API costs per session
- Most common demo queries

### Tools
- OpenAI dashboard (API usage)
- Neo4j browser (database usage)
- Application logs (sessions and errors)
- Google Analytics (frontend usage)

## Alternative Approaches Considered

### Option 1: User-Provided API Keys ❌
**Why not:** 
- Requires users to have OpenAI account
- More complex setup
- Higher barrier to entry

### Option 2: Fully Isolated Demo Instance ✅
**Why yes:**
- Best user experience
- Complete data isolation
- Easy to manage
- Can showcase all features

### Option 3: Limited Feature Demo ✅
**Why yes:**
- Lower costs
- Faster to implement
- Still showcases core value

## Next Steps

1. **Review this strategy** - Does this approach work for you?
2. **Implement Phase 1** - Backend demo support
3. **Test locally** - Verify isolation and limits
4. **Deploy to staging** - Test in production-like environment
5. **Add to portfolio** - Link from your website

## Questions?

If you have questions about:
- Implementation details → See [DEMO_SETUP.md](docs/DEMO_SETUP.md)
- Project status → See [PROJECT_STATUS.md](PROJECT_STATUS.md)
- Technical architecture → See [docs/CODEBASE_OVERVIEW.md](docs/CODEBASE_OVERVIEW.md)

---

**Ready to implement?** Start with Phase 1: Backend Demo Support. See [DEMO_SETUP.md](docs/DEMO_SETUP.md) for detailed implementation guide.
