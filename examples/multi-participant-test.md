# Multi-Participant Test Example

This example demonstrates how to use the new test scenario features for multi-participant testing.

## Use Case 1: Multiple Participants Joining an Experiment

```javascript
// 1. Create a test scenario for the experiment
const scenario = await create_test_scenario({
  name: "Collaborative Task Test",
  description: "Testing 2 participants joining and completing a collaborative task",
  experimentName: "collab_study_v2",
  testParameters: {
    condition: "synchronous",
    difficulty: "medium",
    timeLimit: 300
  },
  tags: ["collaboration", "multi-user"]
});

// 2. Start admin session to set up the experiment
const adminSession = await start_session({
  scenarioId: scenario.id,
  role: "admin",
  label: "Admin1",
  headless: false,  // Watch the admin setup
  url: "https://experiment.example.com/admin"
});

// 3. Admin creates the experiment (using existing tools)
await fill_form({
  sessionId: adminSession.id,
  formData: {
    "#experiment-name": "Test Run 1",
    "#max-participants": "2",
    "#condition": "synchronous"
  },
  submitSelector: "#create-experiment"
});

// 4. Get the experiment URL/code from admin view
const experimentInfo = await extract_text({
  sessionId: adminSession.id,
  selectors: ["#experiment-code", "#participant-url"]
});

// 5. Start first participant session
const p1Session = await start_session({
  scenarioId: scenario.id,
  role: "participant",
  label: "P1",
  headless: false,
  url: experimentInfo.participantUrl
});

// 6. First participant joins
await fill_form({
  sessionId: p1Session.id,
  formData: {
    "#participant-id": "participant1",
    "#experiment-code": experimentInfo.code
  },
  submitSelector: "#join-experiment"
});

// 7. Simulate realistic delay before second participant
await new Promise(resolve => setTimeout(resolve, 3000));

// 8. Start second participant session
const p2Session = await start_session({
  scenarioId: scenario.id,
  role: "participant",
  label: "P2",
  headless: false,
  url: experimentInfo.participantUrl
});

// 9. Second participant joins
await fill_form({
  sessionId: p2Session.id,
  formData: {
    "#participant-id": "participant2",
    "#experiment-code": experimentInfo.code
  },
  submitSelector: "#join-experiment"
});

// 10. Verify all participants are connected
await check_element({
  sessionId: adminSession.id,
  selector: "#participant-count",
  expectedText: "2"
});

// 11. Update scenario state
await update_scenario_state({
  scenarioId: scenario.id,
  phase: "running",
  customData: {
    allParticipantsJoined: true,
    startTime: new Date().toISOString()
  }
});

// 12. List all sessions in this scenario
await list_sessions({
  scenarioId: scenario.id
});

// 13. Get scenario details
await get_test_scenario({
  scenarioId: scenario.id
});

// 14. Clean up when done
await end_test_scenario({
  scenarioId: scenario.id
});
```

## Use Case 2: Admin Makes Changes, Participants Verify

```javascript
// 1. Create scenario
const scenario = await create_test_scenario({
  name: "Admin Parameter Change Test",
  description: "Test that participants see admin parameter changes in real-time",
  experimentName: "parameter_test"
});

// 2. Start admin and log in
const adminSession = await start_session({
  scenarioId: scenario.id,
  role: "admin",
  label: "Admin",
  headless: false
});

await test_login({
  sessionId: adminSession.id,
  url: "https://experiment.example.com/login",
  username: "admin@example.com",
  password: "adminpass"
});

// 3. Create experiment
await navigate_and_wait({
  sessionId: adminSession.id,
  url: "https://experiment.example.com/admin/create"
});

await fill_form({
  sessionId: adminSession.id,
  formData: {
    "#difficulty": "easy"
  }
});

// 4. Start participant and join
const participantSession = await start_session({
  scenarioId: scenario.id,
  role: "participant",
  label: "P1",
  headless: false
});

await navigate_and_wait({
  sessionId: participantSession.id,
  url: "https://experiment.example.com/join"
});

// 5. Verify participant sees initial setting
await check_element({
  sessionId: participantSession.id,
  selector: "#current-difficulty",
  expectedText: "easy"
});

// 6. Admin changes difficulty
await fill_form({
  sessionId: adminSession.id,
  formData: {
    "#difficulty": "hard"
  },
  submitSelector: "#update-settings"
});

// 7. Wait for propagation
await new Promise(resolve => setTimeout(resolve, 1000));

// 8. Verify participant sees the change
await check_element({
  sessionId: participantSession.id,
  selector: "#current-difficulty",
  expectedText: "hard"
});

// 9. Update scenario state
await update_scenario_state({
  scenarioId: scenario.id,
  phase: "completed",
  customData: {
    testResult: "passed",
    parameterChangeVerified: true
  }
});

// 10. Clean up
await end_test_scenario({
  scenarioId: scenario.id
});
```

## Use Case 3: Testing Participant Dropout Recovery

```javascript
// 1. Create scenario for dropout testing
const scenario = await create_test_scenario({
  name: "Dropout Recovery Test",
  description: "Test how the system handles participant disconnection",
  experimentName: "dropout_test"
});

// 2. Start experiment with 3 participants
const sessions = [];
for (let i = 1; i <= 3; i++) {
  const session = await start_session({
    scenarioId: scenario.id,
    role: "participant",
    label: `P${i}`,
    headless: true,  // Run in background
    url: "https://experiment.example.com/join"
  });
  
  await fill_form({
    sessionId: session.id,
    formData: {
      "#participant-id": `participant${i}`
    },
    submitSelector: "#join"
  });
  
  sessions.push(session);
  
  // Realistic joining delay
  await new Promise(resolve => setTimeout(resolve, 2000));
}

// 3. Verify all are connected
for (const session of sessions) {
  await check_element({
    sessionId: session.id,
    selector: "#status",
    expectedText: "connected"
  });
}

// 4. Simulate P2 dropping out
await end_session({
  sessionId: sessions[1].id
});

// 5. Wait for system to detect dropout
await new Promise(resolve => setTimeout(resolve, 3000));

// 6. Verify other participants see the dropout
await check_element({
  sessionId: sessions[0].id,
  selector: "#participant-count",
  expectedText: "2"
});

await check_element({
  sessionId: sessions[2].id,
  selector: "#alert",
  expectedText: "A participant has disconnected"
});

// 7. Simulate P2 rejoining
const p2NewSession = await start_session({
  scenarioId: scenario.id,
  role: "participant",
  label: "P2-rejoined",
  headless: true,
  url: "https://experiment.example.com/join"
});

await fill_form({
  sessionId: p2NewSession.id,
  formData: {
    "#participant-id": "participant2"
  },
  submitSelector: "#rejoin"
});

// 8. Verify recovery
await check_element({
  sessionId: sessions[0].id,
  selector: "#participant-count",
  expectedText: "3"
});

// 9. Get final scenario state
await get_test_scenario({
  scenarioId: scenario.id
});

// 10. Clean up
await end_test_scenario({
  scenarioId: scenario.id
});
```

## Benefits of This Approach

1. **Organization**: All related sessions are grouped under a scenario
2. **Metadata**: Track experiment parameters and test state
3. **Role-based**: Clear distinction between admin/participant sessions
4. **Labels**: Easy identification of sessions (P1, P2, Admin)
5. **Cleanup**: Single command closes all related sessions
6. **Debugging**: Scenario events are logged for analysis

## Tips for Effective Multi-Participant Testing

1. **Use realistic delays** between participant actions
2. **Run participants in headed mode** during development to see issues
3. **Use headless mode** for automated testing
4. **Track scenario state** to understand test progress
5. **Label sessions clearly** for easy debugging
6. **Clean up properly** to avoid resource leaks

## Next Steps

Future enhancements could include:
- Coordinated actions across multiple sessions
- Automatic synchronization checking
- Network simulation for each participant
- Chaos testing features (random dropouts, delays)
- Performance metrics collection
- Test report generation