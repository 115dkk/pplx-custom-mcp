# Repository workflow

- Finish every development task by integrating completed work into `main`. Do not leave finished changes only in a local checkout or an open pull request.
- Choose one delivery path deliberately:
  - Push directly to `main` for low-risk maintainer changes when review is unnecessary.
  - Open a pull request when review, isolation, or a higher-risk rollout is useful.
- Before delivery, run the relevant local checks. For the Worker, the usual gates are `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run --outdir dist`, and `npm audit --audit-level=high`.
- For a pull request, monitor CI for the exact head commit until every check reaches a terminal state. Merge only after the required checks pass. If an exceptional merge is justified by a proven pre-existing or unrelated failure, document that evidence on the pull request first.
- After a direct push or merge, monitor the resulting `main` CI and deployment. Address failures or report the concrete blocker; never silently leave a red or indefinitely queued run.
- At the end of the task, verify the open pull request list. Merge ready work and close superseded, duplicate, abandoned, or intentionally rejected pull requests so the queue stays deliberate.
- Do not modify files under `.github/workflows/` unless the user explicitly asks for a CI workflow change.
