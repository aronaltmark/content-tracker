---
description: Bring in changes from git, and say what's new in the packages
argument-hint: [anything to look out for]
---
Bring this project up to date, make the changes that needs, and say what was found. $ARGUMENTS

1. **This project, from git.** `git fetch`, then say what GitHub has that this copy doesn't (`git log --stat HEAD..@{u}`), and `git pull --ff-only`, whatever is uncommitted. Say what was uncommitted, so it can be told apart from what came in.
   - Anything that stops it - a change here to a file that is coming in, or the branch gone its own way from GitHub's - stop and ask rather than stash, merge or rebase.
   - **Other branches.** Flag any branch on GitHub with commits that this copy or `main` doesn't have (`git fetch --prune`, then `git log main..<branch>` for each of `git branch -r`): say which, and what is on it, so work done elsewhere isn't missed. It only says; bringing one in is asked for.
2. **The packages.** `npm audit --omit=dev`, and `npm audit`: flag anything new, and what it would take to fix it.
3. **Check it**: `npm install` if anything changed the packages, then `npm run verify`, all of it.
4. **Say what was found**: what came in from git, anything from the audit, and anything that needs a decision. Don't commit; `/commit` does that.
