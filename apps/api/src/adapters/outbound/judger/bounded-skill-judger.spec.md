# Bounded Skill Judger

`BoundedSkillJudger` wraps one `SkillJudgerPort` with a process-local limit.

- At most the configured number of delegate operations is active.
- Queued work is admitted FIFO.
- A delegate failure always frees its slot.
- The wrapper forwards the configured model identity unchanged. Reuse rejects a
  candidate when that identity differs or is unavailable.

The limit applies to judgement and optional classification/duplicate calls.
