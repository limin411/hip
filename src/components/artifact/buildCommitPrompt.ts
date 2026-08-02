export type BuildCommitPromptArgs = {
  branch: string
  message: string
  filesNote: string
  uncommittedPaths: string[]
  /** i18n-resolved lines for empty message / files-note fallbacks. */
  messageByAgent: string
  filesByAgent: string
  template: string
}

/**
 * Build the composer prompt for "let the agent commit".
 * Empty message / filesNote become explicit agent-decides instructions.
 */
export function buildCommitPrompt(args: BuildCommitPromptArgs): string {
  const message = args.message.trim() || args.messageByAgent
  const filesNote = args.filesNote.trim() || args.filesByAgent
  const filesList =
    args.uncommittedPaths.length > 0 ? args.uncommittedPaths.join('\n') : '(none)'
  return args.template
    .replace(/\{\{branch\}\}/g, args.branch)
    .replace(/\{\{message\}\}/g, message)
    .replace(/\{\{filesNote\}\}/g, filesNote)
    .replace(/\{\{files\}\}/g, filesList)
}
