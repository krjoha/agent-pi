---
description: "Clean up stale terminal sessions - check health, remove zombies, and self-cleanup when done"
argument-hint: "[status|cleanup|terminate <session_id>|cleanup-self]"
allowed-tools: ["mcp__commander__commander_session_cleanup", "mcp__commander__commander_terminal_sessions"]
---

# Commander Session Cleanup - Terminal Session Lifecycle Management

This command manages terminal session lifecycle and cleanup. Use it to:
- Check session health (stale/zombie counts)
- Clean up old sessions (>24 hours)
- Terminate specific sessions
- Clean up your own session when done

## IMPORTANT: Agent Self-Cleanup Protocol

**Every agent should follow this cleanup protocol:**

1. **At start of major work:** Check session health with `status` operation
2. **If >10 REALLY stale sessions:** Clean them up proactively with `cleanup`
3. **When work is DONE:** Call `terminate_self` to clean up your own session

```
MANDATORY: Sessions older than 24 hours are REALLY stale.
Sessions older than 48 hours are ZOMBIES and MUST be cleaned.
```

---

## Input

Operation: **$ARGUMENTS**

### Available Operations

| Operation | Example | Description |
|-----------|---------|-------------|
| `status` | `/session-cleanup status` | Check stale session counts |
| `cleanup` | `/session-cleanup cleanup` | Remove sessions >24h old |
| `cleanup 6` | `/session-cleanup cleanup 6` | Remove sessions >6h old |
| `terminate <id>` | `/session-cleanup terminate abc-123` | Terminate specific session |
| `cleanup-self` | `/session-cleanup cleanup-self` | Terminate your own session |

---

## Workflow

### 1. Check Session Health (status)

```
mcp__commander__commander_session_cleanup(
  operation="status"
)
```

**Returns:**
```
Session Health:
- Total: 45
- Active: 12
- Stale (>6h): 8
- REALLY Stale (>24h): 15
- Zombie (>48h): 10

Recommendation: Run cleanup_stale immediately! (15 REALLY stale sessions)
```

### 2. Clean Up Stale Sessions (cleanup_stale)

```
mcp__commander__commander_session_cleanup(
  operation="cleanup_stale",
  min_age_hours=24,          // Default: 24 hours
  include_browser_mode=true, // Default: true
  dry_run=false              // Set true to preview
)
```

**Returns:**
```
Cleaned up 25 stale sessions:
- 15 sessions >24 hours old terminated
- 10 zombie sessions (>48h) terminated

Sessions cleaned:
- abc-123: claude, health-dashboard, 36h old
- def-456: cursor, commander, 48h old
...
```

### 3. Terminate Specific Session (terminate)

```
mcp__commander__commander_session_cleanup(
  operation="terminate",
  session_id="abc-123-def-456"
)
```

### 4. Clean Up Your Own Session (terminate_self)

**Call this when your work is complete:**

```
mcp__commander__commander_session_cleanup(
  operation="terminate_self"
)
```

---

## Staleness Thresholds

| Threshold | Time | Status | Action |
|-----------|------|--------|--------|
| Active | <6h | Healthy | None |
| Stale | 6-24h | Warning | Monitor |
| REALLY Stale | 24-48h | Cleanup candidate | Should clean |
| Zombie | >48h | Critical | MUST clean |

---

## Dry Run Mode

To preview what would be cleaned without actually cleaning:

```
mcp__commander__commander_session_cleanup(
  operation="cleanup_stale",
  dry_run=true
)
```

**Returns:**
```
DRY RUN - Would clean up 25 sessions:
- 15 sessions >24 hours old
- 10 zombie sessions (>48h)

No sessions were actually terminated. Run without dry_run=true to clean.
```

---

## MCP Tool Reference

```typescript
{
  name: 'commander_session_cleanup',
  description: 'Manage terminal session lifecycle and cleanup stale sessions.',
  inputSchema: {
    operation: 'status' | 'cleanup_stale' | 'terminate' | 'terminate_self',
    session_id?: string,     // Required for 'terminate'
    min_age_hours?: number,  // Default: 24
    dry_run?: boolean,       // Default: false
    include_browser_mode?: boolean  // Default: true
  }
}
```

---

## Best Practices for Agents

### On Session Startup
```typescript
// Check if cleanup is needed
const status = await mcp__commander__commander_session_cleanup({
  operation: "status"
});

if (status.really_stale_24h > 10) {
  // Clean up before starting work
  await mcp__commander__commander_session_cleanup({
    operation: "cleanup_stale",
    min_age_hours: 24
  });
}
```

### On Session Completion
```typescript
// Always clean up your own session when done
await mcp__commander__commander_session_cleanup({
  operation: "terminate_self"
});
```

### Periodic Health Check
```typescript
// If session count seems high, check and clean
const sessions = await mcp__commander__commander_terminal_sessions({
  operation: "list"
});

if (sessions.length > 20) {
  // Too many sessions - clean up zombies
  await mcp__commander__commander_session_cleanup({
    operation: "cleanup_stale",
    min_age_hours: 48  // Only clean zombies
  });
}
```

---

## Usage Examples

```bash
# Check current session health
/session-cleanup status

# Clean up all sessions older than 24 hours
/session-cleanup cleanup

# Clean up all sessions older than 6 hours
/session-cleanup cleanup 6

# Preview what would be cleaned (dry run)
/session-cleanup cleanup --dry-run

# Terminate a specific session
/session-cleanup terminate abc-123-def-456

# Clean up your own session when done
/session-cleanup cleanup-self
```

---

## Why This Matters

**Problem:** Terminal sessions persist indefinitely in Commander. Without cleanup:
- Memory usage grows continuously
- 64+ stale sessions can accumulate
- Dashboard becomes cluttered
- System performance degrades

**Solution:** Responsible agents clean up after themselves:
1. Check session health at start
2. Proactively clean stale sessions
3. Terminate their own session when done

**Goal:** Keep active sessions < 20 at any time
