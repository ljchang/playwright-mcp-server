# Multi-Participant Test Scenario Development Plan

## Overview
Enhance playwright-mcp-server to support coordinated multi-participant testing for experiments requiring multiple simultaneous users with different roles.

## Core Concepts

### TestScenario
- Superordinate construct that groups multiple browser sessions
- Contains shared metadata (experiment name, parameters, test phase)
- Tracks all associated participant sessions
- Maintains coordination state

### Enhanced Sessions
- Each session links to a parent TestScenario
- Sessions have roles (admin, participant, observer)
- Sessions have labels for easy identification (P1, P2, Admin1)

## Phase 1: Foundation (Week 1)

### 1.1 Data Structure Design
```javascript
TestScenario = {
  scenarioId: string,
  createdAt: timestamp,
  metadata: {
    name: string,
    description: string,
    experimentName: string,
    testParameters: object,
    tags: array
  },
  sessions: Map<sessionId, {
    role: string,
    label: string,
    status: string
  }>,
  state: {
    phase: string,
    customData: object
  }
}
```

### 1.2 Basic Tools to Implement

#### `create_test_scenario`
- Creates new test scenario with metadata
- Returns scenarioId
- Initializes state

#### `list_test_scenarios`
- Shows all active scenarios
- Filter by tags, name, or creation time

#### `end_test_scenario`
- Closes all associated sessions
- Cleans up resources
- Saves final state/logs

### 1.3 Enhanced Session Management

#### Modified `start_session`
```javascript
{
  "tool": "start_session",
  "arguments": {
    "scenarioId": "optional",
    "role": "participant|admin|observer",
    "label": "P1",
    "metadata": {}
  }
}
```

#### Modified `list_sessions`
```javascript
{
  "tool": "list_sessions",
  "arguments": {
    "scenarioId": "optional",
    "role": "optional",
    "includeScenarioInfo": true
  }
}
```

## Phase 2: Coordination (Week 2)

### 2.1 Basic Coordination Tools

#### `execute_in_scenario`
Execute actions across multiple sessions in a scenario
```javascript
{
  "tool": "execute_in_scenario",
  "arguments": {
    "scenarioId": "test-123",
    "actions": [
      {
        "target": "role:participant", // or "label:P1" or "all"
        "action": "navigate",
        "url": "https://experiment.com/join"
      }
    ]
  }
}
```

#### `wait_for_scenario_condition`
Wait for conditions across multiple sessions
```javascript
{
  "tool": "wait_for_scenario_condition",
  "arguments": {
    "scenarioId": "test-123",
    "condition": {
      "type": "all_sessions_ready",
      "check": "element_exists",
      "selector": "#ready-button"
    }
  }
}
```

### 2.2 State Verification

#### `verify_scenario_state`
Check conditions across all sessions
```javascript
{
  "tool": "verify_scenario_state",
  "arguments": {
    "scenarioId": "test-123",
    "verifications": [
      {
        "target": "role:admin",
        "selector": "#participant-count",
        "expected": "2"
      },
      {
        "target": "role:participant",
        "selector": "#status",
        "expected": "connected"
      }
    ]
  }
}
```

## Phase 3: Realistic Testing (Week 3)

### 3.1 Timing Simulation

#### `simulate_realistic_timing`
Add realistic delays and variations
```javascript
{
  "tool": "simulate_realistic_timing",
  "arguments": {
    "scenarioId": "test-123",
    "profile": "realistic", // or "fast", "slow", "variable"
    "config": {
      "joinDelay": [1000, 5000], // random range
      "actionDelay": [100, 500],
      "networkLatency": "3g"
    }
  }
}
```

### 3.2 Basic Chaos Features

#### `simulate_participant_issue`
Simulate common real-world issues
```javascript
{
  "tool": "simulate_participant_issue",
  "arguments": {
    "scenarioId": "test-123",
    "target": "label:P2",
    "issue": "disconnect", // or "refresh", "slow_network", "browser_back"
    "timing": "after_action:join"
  }
}
```

## Phase 4: Diagnostics (Week 4)

### 4.1 Diagnostic Tools

#### `get_scenario_timeline`
Get chronological event timeline across all sessions
```javascript
{
  "tool": "get_scenario_timeline",
  "arguments": {
    "scenarioId": "test-123",
    "includeNetworkRequests": true,
    "includeStateChanges": true,
    "includeUserActions": true
  }
}
```

#### `diagnose_sync_issues`
Analyze synchronization problems
```javascript
{
  "tool": "diagnose_sync_issues",
  "arguments": {
    "scenarioId": "test-123",
    "expectedState": {
      "all_participants": "in_experiment"
    }
  }
}
```

### 4.2 Reporting

#### `generate_scenario_report`
Create comprehensive test report
```javascript
{
  "tool": "generate_scenario_report",
  "arguments": {
    "scenarioId": "test-123",
    "format": "html", // or "json", "markdown"
    "include": ["timeline", "screenshots", "errors", "performance"]
  }
}
```

## Implementation Priority

### Week 1: Essentials
1. ✅ Design data structures
2. ⬜ Implement TestScenario class
3. ⬜ Add create/list/end scenario tools
4. ⬜ Enhance start_session with scenario support
5. ⬜ Update list_sessions for scenario filtering

### Week 2: Coordination
1. ⬜ Implement execute_in_scenario
2. ⬜ Add wait_for_scenario_condition
3. ⬜ Create verify_scenario_state
4. ⬜ Build example multi-participant test

### Week 3: Realism
1. ⬜ Add timing simulation
2. ⬜ Implement basic chaos features
3. ⬜ Create participant issue simulation
4. ⬜ Test with real experiment scenarios

### Week 4: Polish
1. ⬜ Build diagnostic tools
2. ⬜ Add timeline generation
3. ⬜ Create reporting features
4. ⬜ Write comprehensive documentation

## Success Metrics

1. **Functionality**: Can successfully run 2-4 participant tests
2. **Reliability**: Tests are reproducible and stable
3. **Debugging**: Easy to identify why tests fail
4. **Realism**: Tests catch real synchronization issues
5. **Performance**: Can run multiple scenarios concurrently

## Example Usage After Implementation

```javascript
// 1. Create test scenario
const scenario = await create_test_scenario({
  name: "Collaborative Task Test",
  metadata: {
    experimentName: "collaboration_study_v2",
    testParameters: { difficulty: "medium", timeLimit: 300 }
  }
});

// 2. Start admin session
const adminSession = await start_session({
  scenarioId: scenario.id,
  role: "admin",
  label: "Admin1"
});

// 3. Admin creates experiment
await fill_form({
  sessionId: adminSession,
  formData: { "#exp-name": "Test Run 1" }
});

// 4. Start participant sessions with realistic timing
const p1 = await start_session({
  scenarioId: scenario.id,
  role: "participant",
  label: "P1"
});

await sleep(3000); // Realistic delay

const p2 = await start_session({
  scenarioId: scenario.id,
  role: "participant",
  label: "P2"
});

// 5. Coordinate joining
await execute_in_scenario({
  scenarioId: scenario.id,
  actions: [
    { target: "role:participant", action: "click", selector: "#join" }
  ]
});

// 6. Verify state
await verify_scenario_state({
  scenarioId: scenario.id,
  verifications: [
    { target: "role:admin", selector: "#count", expected: "2" },
    { target: "role:participant", selector: "#status", expected: "ready" }
  ]
});

// 7. Simulate an issue
await simulate_participant_issue({
  scenarioId: scenario.id,
  target: "label:P2",
  issue: "disconnect"
});

// 8. Check recovery
await verify_scenario_state({
  scenarioId: scenario.id,
  verifications: [
    { target: "label:P1", selector: "#status", expected: "waiting" }
  ]
});

// 9. Generate report
await generate_scenario_report({
  scenarioId: scenario.id,
  format: "html"
});

// 10. Cleanup
await end_test_scenario({ scenarioId: scenario.id });
```

## Next Steps

1. Review and refine this plan
2. Set up development environment
3. Create feature branch: `feature/multi-participant-scenarios`
4. Start with Phase 1 implementation
5. Create tests for each new feature
6. Document as we build