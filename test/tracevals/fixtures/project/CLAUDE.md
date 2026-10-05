---
metadata:
  evals:
    # A conditional trigger arms this only for the sessions it is about
    # (ADR 01016). This session edited src/app.ts, so the trigger fires and
    # fix-bug was invoked: pass.
    - id: source-edits-use-the-fix-bug-skill
      assertion: A session that edits source files invokes the fix-bug skill.
      grader: skill-invoked
      options:
        skill: fix-bug
        expect: used
        when:
          file-access: "src/**"
    # The same shape, armed on something this session never touched. It must
    # report `skipped`, never `pass` — a check that never armed has not been
    # satisfied, and a silent pass here would gut the feature.
    - id: docs-work-uses-the-writing-skill
      assertion: A session that edits documentation invokes the writing skill.
      grader: skill-invoked
      options:
        skill: writing-toolkit:identify-ai-tells
        expect: used
        when:
          file-access: "docs/**"
---

# Demo Project Rules

- Always run the test suite before declaring work done.
- Never commit directly to main.
