# Provider usage

Shows usage from enabled usage-source plugins in the sidebar. The card lists every
provider at once, each with its icon, name, and one thin bar per limit (5h, 7d,
and any model-scoped window). Pooled accounts stack under their provider. Shared
sources such as Account Pooler are selected by default; an explicit machine
selection shows that machine’s local usage instead.

An unconfigured shared source remains selectable and shows setup guidance.
Failed refreshes retain the last available measurements with a retry notice.
Account authentication failures and plans without reported limits have separate
states; unavailable usage is never represented as zero consumption.

Each quota window shows remaining allowance derived only from the reported used
percentage; over-limit windows show zero remaining and stay marked over limit.
Each account shows its last successful measurement time (`observedAt`), which
cached reads and failed refreshes never advance. When a window's reset passed
after that measurement, or the measurement time is unknown, remaining allowance
is unavailable until a successful refresh. Five-hour and weekly windows also show
pace compared with even usage through the window, as of that measurement; other
windows say why pace is unavailable. The read-only detail content
(`UsageDetails`) is shared by the settings page and can be reused by other
surfaces. "View usage details" in the sidebar card opens that page on the same
source.

Local Claude Code, Codex, ACP and cloud Claude usage arrives through the
provider bridge contract, whose `usedPercent` is rounded and capped at 100.
Current producers also send the raw `reportedUsedPercent`, which the source
plugins prefer, so over-limit amounts and pace stay exact. Producers send it
only for a measured value; missing usage stays unavailable. A window whose raw
value is absent, null or not a finite nonnegative number is marked capped: 100
reads "At or over limit", and pace is unavailable because the exact value is
unknown.

Known limits: Codex accounts kept by the website
report no measurement time, window type or length: they show their reported
usage with "Last update unavailable", get no pace, and become unavailable once
their reported reset passes.

Settings → Agents → Usage contains the usage page, using its
full-size provider groups with email-labeled accounts and fetching only resources in the selected pool or machine. Both surfaces share the plugin’s aggregation and cache. Neither display is required for source
plugins to publish their usage.

Use `bb plugin rpc list --method provider-usage.v1.listResources --json` to find sources
and `bb plugin rpc inspect <plugin-id> provider-usage.v1.listResources --json`
to inspect their published contracts. RPC calls accept JSON through
`--input-file`. See the Plugin Guide for the contract API.

`bb settings usage --json` and `bb.sdk.system.usageLimits()` remain the
host-local provider-maintenance view; they do not aggregate shared pool accounts.

Codex, Claude Code, and ACP provider plugins explicitly implement the usage contract
for their own providers. Account Pooler implements it for shared accounts. The
contract is owned here and copied into each source; no additional adapter plugin,
provider-kit helper, or core runtime convention is required. Other providers must
explicitly implement the contract to appear in these displays.

Known provider-issued account identities are deduplicated within the selected
location. Unknown identities are never merged by email. Structured plan and quota
window metadata give both displays consistent labels.

Provider Usage is enabled by default for newly registered installations. Existing
explicit enable/disable choices are preserved. Right-click the footer shortcut and
choose **Hide** to move it into **More**. Settings → Appearance → Sidebar footer
controls order and visibility for every footer action. The usage settings page
remains available. These preferences belong to BB, not the plugin.
