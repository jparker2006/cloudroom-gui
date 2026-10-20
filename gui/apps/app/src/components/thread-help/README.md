# Thread help

Static, curated help for thread controls and states. One list of topic records in
`thread-help-topics.ts` feeds both the contextual `?` buttons and the searchable
help panel. There are no AI calls, no network requests, and no access to threads,
accounts, or `plugins/docs`. Help never changes settings, accounts, or agents; it
names the existing surface to use instead.

## Topic links

Each topic has a stable kebab-case `id`. `threadHelpHref(id)` returns
`#thread-help/<id>`; the thread's header help button opens that topic. Never
rename an id. To retire a topic, keep its id pointing at the closest topic.

## Maintenance contract

Update a topic in the same change as anything it describes:

1. Each topic lists `sources`: the files that own the behavior it explains. If
   you change one of those files in a way users can see, reread the topics that
   cite it.
2. Docs links come only from `THREAD_HELP_DOCS`. Add a URL there only after
   opening it and checking its `#anchor` exists. Last checked: 2026-10-20.
3. Say what the product shows. Say when data is missing, stale, or estimated.
   Never imply that awake means working or that idle means done. Leave out plan
   numbers that the website owns; link to them.
4. Keep answers short: a summary, up to five points, and an optional next step.

`thread-help-topics.test.ts` enforces the parts a test can check: ids, related
links, source files exist, docs links come from the list, answer length, and the
awake/idle and missing-data wording.
