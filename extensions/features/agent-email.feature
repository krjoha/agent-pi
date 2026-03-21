Feature: Agent Email Sending
  As a user of Pi CLI
  I want the agent to send emails on my behalf
  So that I can receive reports and notifications without manual intervention

  Background:
    Given Commander is connected with AgentMail configured
    And the default recipient is "ruizrica2@gmail.com"

  # ── Report Emails ───────────────────────────────────────────────

  Scenario: Agent sends a completion report via email
    Given the agent has completed a task with a report
    And the report name is "Feature Implementation Complete"
    And the report content is "## Summary\nAdded OAuth login with Google provider"
    When the agent calls the send_email tool with type "report"
    Then commander_agentmail should be called with operation "send:report"
    And the report_name should be "Feature Implementation Complete"
    And the content should contain the report markdown
    And the tool should return a success result

  Scenario: Agent sends report email to a custom recipient
    Given the agent has completed a task with a report
    When the agent calls the send_email tool with:
      | field       | value                      |
      | type        | report                     |
      | to          | team@example.com           |
      | report_name | Deploy Report              |
      | body        | Deployed v2.0 to production|
    Then commander_agentmail should be called with to "team@example.com"
    And the tool should return a success result

  # ── Generic Emails ──────────────────────────────────────────────

  Scenario: Agent sends a generic email with custom content
    Given the agent has content to share
    When the agent calls the send_email tool with:
      | field   | value                            |
      | subject | Build Results                    |
      | body    | All 42 tests passed. No errors.  |
    Then commander_agentmail should be called with operation "send:custom"
    And the subject should be "Build Results"
    And the format should default to "markdown"
    And the tool should return a success result

  Scenario: Agent sends HTML email
    When the agent calls the send_email tool with:
      | field   | value                          |
      | subject | Styled Update                  |
      | html    | <h1>Hello</h1><p>World</p>     |
    Then the format should be "html"
    And the content should be the raw HTML

  # ── Briefing Emails ─────────────────────────────────────────────

  Scenario: Agent sends a morning briefing
    When the agent calls the send_email tool with:
      | field | value                                          |
      | type  | briefing                                       |
      | body  | # Morning Briefing\n- 3 tasks done\n- 2 PRs    |
    Then commander_agentmail should be called with operation "send:briefing"
    And the content should contain the briefing markdown

  # ── User Intent ─────────────────────────────────────────────────

  Scenario: User asks agent to email report after task completion
    Given the user said "email me the report when you're done"
    And the agent has completed all tasks
    And a completion report has been generated
    When the agent processes the user's email request
    Then the agent should call the send_email tool with type "report"
    And the email should contain the completion report content
    And the agent should confirm the email was sent

  # ── Error Handling ──────────────────────────────────────────────

  Scenario: Email fails when Commander is not connected
    Given Commander is NOT connected
    When the agent calls the send_email tool with:
      | field   | value                |
      | subject | Test                 |
      | body    | Hello                |
    Then the tool should return an error
    And the error message should mention "Commander"

  Scenario: Email fails when subject is missing for generic email
    When the agent calls the send_email tool with:
      | field | value |
      | body  | Hello |
    Then the tool should return an error
    And the error message should mention "subject"

  Scenario: Email fails when body is missing for generic email
    When the agent calls the send_email tool with:
      | field   | value |
      | subject | Test  |
    Then the tool should return an error
    And the error message should mention "body"

  Scenario: Email fails when content is missing for report
    When the agent calls the send_email tool with:
      | field       | value       |
      | type        | report      |
      | report_name | Test Report |
    Then the tool should return an error
    And the error message should mention "content"

  Scenario: AgentMail API returns an error
    Given AgentMail will return an error "rate_limit_exceeded"
    When the agent calls the send_email tool with:
      | field   | value            |
      | subject | Test             |
      | body    | Hello            |
    Then the tool should return an error
    And the error message should contain "rate_limit_exceeded"
