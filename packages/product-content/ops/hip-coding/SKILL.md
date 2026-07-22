# hip-coding (operational policy)

This skill expands the **compact** always-on coding rules in the system prompt. Follow it for multi-step, multi-agent, large-edit, git-heavy, or long-running background work.

## File edits

- Prefer `edit_file` for localized changes (font sizes, labels, small SVG/HTML/CSS fixes, single functions).
- Avoid a single `write_file` that rewrites multi-thousand-line files — large one-shot rewrites can stall.
- Edit in sections with `edit_file`, or rewrite only when creating a new file or a true full replacement is required.
- When `read_file` output is truncated, re-read missing ranges with `offset`/`limit` before editing — do not invent the rest of the file from a partial read.

## Planning (`write_todos`)

- For multi-step tasks, call `write_todos` first with an ordered checklist.
- Mark exactly one item `in_progress` at a time; flip items to `completed` as you finish them.
- Skip todos for simple single-step requests.

## Delegation & parallel fan-out

- Large, self-contained chunks or isolated research: `task`, `dispatch_agent`, or `task_batch`.
- Prefer specialized roster agents: **explore** (read-only search), **plan** (design-only), **coder** (implementation with scripts).
- **CRITICAL — parallel fan-out:** when the user asks for parallel work or you have 2+ independent sub-tasks, you MUST use a **single** `task_batch` with one entry per sub-task.
- Set each task's optional `agent` field to a specialized roster id (e.g. explore) when available.
- `task_batch` runs sub-agents concurrently. Do NOT issue multiple sequential `dispatch_agent` or foreground `task` calls for independent work — that is serial and slow.
- `dispatch_agent` alone is blocking (one at a time) unless the model emits several `dispatch_agent` calls in the same tool-call batch (then they may run in parallel).
- Never claim work ran "in parallel" if you only used sequential `dispatch_agent`/`task`.
- Fire-and-forget sub-agent: `task` with mode `background`, then `task_output` / `task_stop` as needed.
- When a sub-agent result returns, treat it as the research source of truth: do not re-run the same ls/glob/grep/read_file exploration unless the result is empty, errored, clearly incomplete, or you need a specific file section the summary omitted.
- Simple single-step requests (greetings, list a directory, read one file, short Q&A): do it yourself — do not call task, task_batch, write_todos, or spawn sub-agents.

## Async TaskRuntime (shell / monitor / schedule)

Long work must not block the supervisor turn. Use TaskRuntime tools; the session **right panel → Runtime** (combined with Agents) shows running/completed jobs.

| Tool | When |
|------|------|
| `run_script` with `background:true` | Long shell builds, tests, installs — returns `task_id` |
| `wait_tasks` | Wait for one or more background task ids (`wait_all` / `wait_any`; optional `timeout_ms`) |
| `task_output` | Read accumulated output (shell, agent, monitor) without busy-waiting |
| `task_stop` | Kill a running background task |
| `monitor` | Stream a command’s stdout as UI events (CI/log tails). Lines are **not** auto-injected into the model — use `task_output`. Prefer tight filters (`grep --line-buffered`). |
| `scheduler_create` / `scheduler_list` / `scheduler_delete` | Recurring checks (interval strings like `5m`, `2h`; min 60s). Prefer over foreground sleep loops. |

Rules:

- Do **not** sleep-poll the main turn waiting for long shell or CI.
- Never invent shell tool names — only `run_script` for shell.
- Prefer `wait_tasks` when you need completion of known ids; use `task_output` for partial logs.
- Monitor streams surface in the Runtime panel / notifications; still call `task_output` when you need the text in-context.
- Sub-agent background and shell background share the same task id / output / stop APIs.

## Git

- Tools: `git_commit`, `git_create_branch`, `git_switch_branch`.
- Commit proactively after a coherent unit of work with a concise one-line message (under 72 characters, imperative mood).
- Group related edits into a single commit — do not commit after every individual file write.
- Use branch create/switch only when the work warrants a separate line of history (experimental or large refactor).
- These tools commit on the user's behalf — keep messages clear and history clean.

## Shell & failures

- Use `run_script` for shell; never invent shell tool names.
- Short, quick commands may run in the foreground; anything that can take minutes should use `background:true`.
- Never thrash on `.git/objects`.
- When a tool fails or returns binary/unreadable content, stop probing and summarize what you know.
