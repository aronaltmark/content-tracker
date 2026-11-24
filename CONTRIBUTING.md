# Contributing

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome - for anything big, open an issue first so we can agree on the approach before you put the time in.

## Reporting a bug or asking for something

Use the [bug report or feature request forms](https://github.com/garethnunns/content-tracker/issues/new/choose). Leave out tokens, service account keys and anything from `sign-ins.json` - issues are public.

For a security problem, don't open an issue: report it privately from the repository's **Security** tab instead.

## Setting up

You'll need Node 22.12 or newer (Node 24 is what the checks use - `.nvmrc` says so).

```sh
git clone https://github.com/garethnunns/content-tracker.git
cd content-tracker
npm install
npm run dev
```

`npm run dev` opens the app, reloading as you change it. The command line runs with `node cli/index.js -c your-config.json`, or `npm link` once and then `tracker -c your-config.json`.

Signing in with Google needs the app's client secret, which isn't in git: set `GOOGLE_CLIENT_SECRET` before `npm install`, or `CONTENT_TRACKER_GOOGLE_CLIENT_SECRET` when running it. Signing in with Airtable, and everything else, works without it.

## How it fits together

- `core/` is the tracker itself: scanning, the media metadata, working out what's changed and the Airtable and Google Sheets targets. It doesn't know how it's being run, never prints, and logs through the logger it's given. It can be used on its own: `import { syncOnce } from '@garethnunns/content-tracker'`.
- `cli/` is the command line, which is what npm gets, and `gui/` the Electron & Vue app. Both only wrap `core/`.
- `e2e/` has the end-to-end tests, and pretend versions of Airtable, Google, npm and GitHub that they run against.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app, reloading as you change it. |
| `npm run build` | Builds the app into `out/`. |
| `npm run lint` | Lints everything. |
| `npm test` | Runs the unit tests. |
| `npm run test:e2e` | Runs the end-to-end tests: the real command line and app, against pretend versions of Airtable, Google, npm and GitHub. |
| `npm run verify` | Lints, tests and builds. |
| `npm run check` | `verify`, then the end-to-end tests. |
| `npm run dist` | Builds the app for the computer you're on, into `release/`. |
| `npm run dist:mac` | Builds the app for both kinds of Mac, Apple Silicon and Intel. |
| `npm run schema` | Writes `core/config.schema.json`, which editors use to help write a config, from `core/config-schema.js`. Run it after changing that. |
| `npm run readme` | Puts `docs/help.md`, the app's Help, into the README's App section. Run it after changing that. |
| `npm run screenshots` | Takes the pictures in `docs/screenshots`: each of the app's tabs in a Mac window, its menu in the menu bar, and mock-ups of the tables in Google Sheets and Airtable. The app's the real thing, against pretend Airtable and Google. Every release takes them again and attaches them as `screenshots.zip`. |
| `npm run icons` | Makes the PNGs from the icon, `build/icon.svg`, and the menu bar's, `build/tray.svg`. Run it after changing either. |

Windows has to be built on Windows, as ffprobe is a different program on each, and a build stops if it hasn't got the right one.

## The rules that matter most

These keep people's tables safe, so a pull request that breaks one will be asked to change:

- **Nothing is removed after a scan that came back short.** Anything that couldn't be read - a drive that's gone, a folder without permission - has to end up in the scan's errors, so that run removes nothing.
- **What's written to a table is what people's rows are matched on.** Changing `_path`, or how any field is worked out, can update or replace every record in someone's table, taking their own columns with it. That's a breaking change, and needs talking about first.
- **Airtable and Google Sheets stay interchangeable.** Something new a target does goes on both.
- **Paths work on Mac and Windows.** Use `path` for anything on disk and `path.posix` for anything written to a table, in the tests too.
- **Tokens and sign ins never go into a config, the app's page or git.**
- **Anything written to a sheet stays `RAW`**, so a file name can't run as a formula.

And for the words people read: UK English, single dashes rather than double, and hints in the app as short as they can be.

## Checking your change

```sh
npm run verify   # lint, unit tests and the build
npm run check    # all of that, then every end-to-end test
```

Run `npm run check` before opening a pull request - the same runs on Mac and Windows for every pull request, and has to pass. Add tests for what you change: the unit tests sit beside the code (`*.test.js`), and anything the app or command line does end to end goes in `e2e/`.

If you change what a config can hold, edit `core/config-schema.js` and run `npm run schema`. If you change the app's Help, edit `docs/help.md` and run `npm run readme`.

## Licence

Content Tracker is licensed under the [GNU GPL, version 3 or later](LICENSE). By opening a pull request you agree that what you contribute is under that licence too.
