---
description: Commit what has changed and push it - a short, witty subject, the detail in the body
argument-hint: [anything the message should mention]
---
Commit the work in progress. $ARGUMENTS

1. Look at all of it: `git status` and `git diff`, staged and not. Leave out anything that was only ever temporary (a scratch test, a probe, a file of notes) and say what was left out. Never commit a `config*.json`.
2. Run the checks CLAUDE.md asks for before a commit, for what it changes: everything (`npm run check`), `npm run verify` and the test files changed, or `npm run verify` alone - CLAUDE.md says which. If anything fails, stop and say what, rather than commit around it.
3. Write the message:
   - **Subject**: short, to the point and witty if possible - a few words, no full stop. If the commit changes the version in `package.json`, the subject ends with `; <version>` (`Fonts all the way down; 0.2.0`).
   - **Body**: the detail - what changed and why, as bullets, enough for someone reading the log months from now to follow without the diff.
   - Never a `Co-Authored-By` line, or any other attribution to Claude.
4. Commit, then push it to GitHub (`git push`; if GitHub has moved on, stop and say so rather than merge). Show what went (`git log -1 --stat`).
