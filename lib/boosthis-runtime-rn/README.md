<!--
  BOOSTHIS-OWNED — DO NOT EDIT.
  This file is vendored from the Boosthis kit. Editing it makes the kit report
  a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
  the next entitlement check-in. To change Boosthis, update it via the hosted
  Boosthis MCP server instead of editing here.
-->

# boosthis-runtime (RN source, v1.0.0-alpha.246)

<!-- KIT_CHANGELOG
1.0.0-alpha.246 — Legal documents only, no code change. The TERMS.md packed
with this kit gains three clauses it never had. A new Section 27 says how a
rights holder reports material they believe infringes their copyright, what a
report has to contain, what happens after one, how to answer a removal, and
what happens to an account that infringes repeatedly. A new Section 28 covers
an application directed at children: the notice and any verifiable guardian
consent belong to you, it names what must never be sent to Boosthis from such
an app, and it says what Boosthis does once told an application is
child-directed. Section 1 now states TWO age floors rather than one — sixteen
to hold an account, eighteen or the age of majority where you live to buy a
Paid Plan — and why they differ. Nothing this kit measures, sends or reports
has changed.

1.0.0-alpha.245 — Legal documents only, no code change. The TERMS.md packed
with this kit now describes how an approved rule actually reaches you: a rule
the maintainer approves may be served as written, straight away over the HTTP
API and the MCP server, rather than only landing in a later kit release. Rule
text may be machine-generated and is human-reviewed, a review is not a
verification that a fix is correct or safe for your app, applying a fix
automatically is your own decision and risk, and a served rule may be
re-worded or withdrawn at any time. Material submitted to the rule book
through the MCP server or the HTTP API is assigned on the same terms as
telemetry, and the submitter warrants it was theirs to send.

1.0.0-alpha.244 — The Terms and Privacy Policy shipped inside this kit
now describe the Boosthis extension for Visual Studio Code reading a
developer's own chat messages. Only the developer's own turns are read,
on their own machine, per project, and only once it is switched on; the
assistant's own messages are not read, parsed or kept. No conversation
text, prompt, file or diff leaves the machine — what is sent is the same
short screened work-item name and time the connection already accepts —
and a table names each assistant tool that can be read and each one that
cannot, with the reason. No code in this kit changed and it sends
nothing new.

1.0.0-alpha.243 — An axis band with reversed good and poor constants, or a
non-finite endpoint, is now refused with a named error instead of being scored.
The budget verdict now ships with its score.

1.0.0-alpha.242 — The press-to-screen reading now reports what it has seen
rather than waiting in silence: presses that reached the kit but not this
reading, a press followed by a router this kit could not read, or five
presses with no navigation observer mounted. The last is answered by mounting
the observer; a router it cannot read needs a supported navigation container,
or route values fed straight in. An app nobody has pressed is still warming
up.

1.0.0-alpha.241 — The Terms shipped inside this kit now say what the browser
kit's development-posture check does: it makes one HEAD request to your own
site for the first script's ".map" address and keeps only whether the answer
was OK, and it reads NODE_ENV inside your own process to report whether a
development build is running, as a 1 or a 0. Two older lines denied both of
those reads outright, which was wrong in those two narrow ways; hostnames and
the values of environment variables are still never sent anywhere. Nothing
this kit does has changed.

1.0.0-alpha.240 — The Terms shipped inside this kit now describe what an
uploaded build map leaves behind: its original source paths, its identifier
and method names, and the table joining them to the compiled output, kept for
90 days from the upload. An older line listed file paths among the things
never kept, which was wrong — "Boosthis never reads your codebase" stays as
its own promise, and the file-paths half now carries the build-map exception
in the same sentence. The same document scopes its recipients sentence to the
companies Boosthis engages and names the destinations a customer can point it
at, names every company that can sit in the AI path, and says that a project
name is stored exactly as it was typed. Nothing this kit does has changed.

1.0.0-alpha.239 — The navigation reading now spans the whole wait: from the
press until the destination screen's own reading completes, rather than
stopping when that screen began to mount. The dead time before anything
appeared stays beside it as its own number, and the screen's own settling time
sits next to it. A press that could not be joined to a screen is counted and
reported — one count for a screen that arrived past the join bound, one for a
press no screen followed — where before a slow navigation was discarded and
only the quicker ones were reported. The bound is 15 seconds and it is stated
with the reading. Nothing here feeds the overall score.

1.0.0-alpha.238 — The Terms shipped inside this kit now say how long Boosthis
keeps a support message you send it. Once your request is closed the message
is deleted after 365 days; while it is still open it is kept until it is
closed, because it cannot be answered otherwise. The old wording said only
that support mail was kept while it was useful, which named no limit at all.
Nothing this kit does has changed.

1.0.0-alpha.237 — The Terms shipped inside this kit now name every place a
Boosthis kit reads a request body, a response body, a header, a cookie or a
query value inside your process, with the limit on each. The old wording
named one of them — the AI-call meter's prompt prefix — and called it the
only one, which was wrong. Nothing this kit does has changed: none of that
text is uploaded, and the guard on the upload path still refuses outright a
payload carrying a body, a header, a cookie or a query value.

1.0.0-alpha.236 — The kit now says so when the dashboard is overriding the
sharing mode your code asked for. `issuesOnly` is your setting, but a
project's "Full telemetry" switch wins in both directions — on forces full
mode even where the code asked for reduced, off forces reduced even where
the code asked for full — and nothing said so, so a developer could read
their own source and believe something false. The kit now warns once, in the
Metro console, naming BOTH what your code asked for and what is actually in
force. It also reports the mode your code asked for when it registers, so
your dashboard can show the two values side by side rather than leaving you
to guess what turning the switch off would leave behind.

1.0.0-alpha.235 — The Disclaimer shipped inside this kit now says what
Boosthis costs the app it runs in, and what its safety claim does and does
not cover. The cost is measured per runtime against the same application
with the kit absent — throughput, added latency per request, resident
memory, and for the browser kit the bytes every visitor downloads — and a
runtime nobody has measured yet says so rather than being left blank. The
wrapping that keeps a fault inside Boosthis from throwing into your code is
described as a discipline we keep and check, not a warranty: it does not
cover a fault that starves your process, and it says nothing about speed.
An older sentence in some release notes saying Boosthis can never slow or
crash your app is superseded there. No code in this kit changed.

1.0.0-alpha.234 — The Terms and Privacy Policy shipped inside this kit now
describe how text an assistant wrote can reach Boosthis: a Claude Code
hook a developer installs, which after each turn sends at most four of the
assistant's closing lines to be checked against that project's own
measurements, and the tools a connected assistant can call with one line
it wrote itself. Fenced code blocks are dropped before anything is sent,
and the documents say plainly that a line left outside a fence travels
with the prose. No code in this kit changed and it sends nothing new.

1.0.0-alpha.232 — The guide and README now say plainly what this kit puts into
the app it is installed in, before you ship it rather than after. The floating
bubble is described as on by default, with the setting that hides it named in
the same breath, and no guide now calls it a mandatory setup step. A phone app
serves nothing, so this kit mounts no address a stranger could request, and
the guide now says so instead of leaving you to work it out. Nothing about
what the kit measures, sends or displays changed.

1.0.0-alpha.231 — New: your project page now names YOUR app's version, and
the background work your app schedules. Every reading this kit has ever sent
carried a version, and that version was this kit's own — so the release
history on your page was empty for every app, for ever. This release reads
the version out of the build it is running inside
(CFBundleShortVersionString on iOS, versionName on Android), sends it under
its own name beside ours, and the first upload after you ship a new build
records that release with nobody declaring anything. The two versions are
never mixed and the page says which one it is showing. Also new: background
tasks. Anything your app defines through Expo's TaskManager is timed from
now on with no call site to edit — the job's name, that it ran, whether it
succeeded and how long it took, and nothing about what it did. An app that
schedules none reads as exactly that rather than as a runtime we cannot see
into, and a run that should have happened and did not is visible on the
page. Neither reading is optional and neither costs you a line of setup.

1.0.0-alpha.230 — New: your app can draw its own circuit, and you write no
tracing to get it. Until now the wiring diagram on your project page was built
only from calls you had rewritten by hand, one call site at a time, so most
apps had a blank one for ever. Add `traceScreens` to enableTelemetry() and
each screen your app moves to becomes a part of the picture, moving between
two screens becomes a link, and every request a screen makes hangs off that
screen — on the transports this kit already watches, with no navigator to hand
over and no call site to edit. One request is one step however many layers
wrap it, and this kit's own uploads are never in your picture. What travels is
the screen's route name, the method and the path with ids removed, a duration
and whether it worked: never a host, a query string, a screen parameter or
anything typed. The trace header is written only to the hosts you name in
`propagateTo`, so a third party never receives one. Off unless you switch it
on, and with it off nothing about this kit's behaviour differs from the
release below.

1.0.0-alpha.229 — Rates now earn their window across the runs of your app,
instead of starting again from nothing every launch. Crash-free, app hangs,
frozen frames, unhandled errors, foreground residency and the two churn
readings are all rates — events per hour — and a rate is not published until
enough has been watched to project one honestly. That watching used to have
to happen inside a single run, and a phone app is used in bursts of a few
minutes, so those readings stayed at "measuring…" for ever no matter how much
the kit measured. The kit now banks what each run watched and counted, in
this app's own storage on this device, and the next launch adds to it. The
honesty rule has not moved: nothing is published until the window is genuinely
earned, and a crash, a hang, a frozen frame or an error still surfaces the
moment it happens. While a reading is still short, it now says how much time
has been banked so far and how many runs it spans, rather than an unqualified
"measuring…". The ledger holds numbers only — durations and counts, no label,
no address, nothing identifying — it covers a rolling day, it never leaves the
device, it never mixes with another app, another device or another project
key, and forget() erases it with everything else.

1.0.0-alpha.228 — One launch now registers once. While this install holds no
credential, every path that asks for consent — the first-launch handshake, an
explicit consent() call, the retries inside the upload channels — was posting
separately, and two that overlapped raced each other: the loser was told the
row already exists but could not prove it owns it, which is the signal that
makes the kit rotate to a fresh identity. One phone could file a second
install in a single launch. Those tokenless calls now share one request. A
re-consent after registration still posts for itself, so a coverage change is
reported immediately. The install guide states the matching rule for your own
code: keep the stored install id even when the credentials beside it are gone.

1.0.0-alpha.227 — Three collectors now start themselves. The network
wrapper, the unhandled-error hooks and image weight each needed a line of
setup almost no app ever wrote, so their meters sat at "measuring…" for ever
with nothing wired behind them — and unhandled JavaScript errors, the most
basic thing a mobile kit watches, were not being counted at all. All three
now start with enableTelemetry(), which reverses the default set in
1.0.0-alpha.209 below. Each can be refused by name — `autoWrapNetwork: false`,
`trackUnhandledErrors: false`, `trackImageWeight: false` — and a refused meter
says it is switched off in this build rather than claiming to measure. Nothing
new is sent: the same duration and coarse outcome, the same counts, and still
no field anywhere for a URL, host, path or status.

1.0.0-alpha.226 — The bundled terms now name a chat workspace you connect as
yours rather than ours. Boosthis can post the alerts you asked for into a
Slack channel you pick, with a credential you grant and can revoke, so the
terms name that alongside the alert webhook you configure and the AI
assistant you connect — all three are destinations you chose, not companies
Boosthis engaged. No company was added to the list of those that can see your
data. This kit is unchanged apart from the legal documents it carries.

1.0.0-alpha.225 — The kit now reports which of its own collectors it actually
reached. Every Android session was arriving with no measurements in it, and
a kit that attached nothing looked exactly like an app nobody used — the
same empty snapshot, and no way to tell the two apart. Each session now
states the collectors that positively ran, sent with the install rather
than guessed from a zero further downstream. An empty list is now an
answer, not silence.

1.0.0-alpha.224 — The JS startup reading now reads the clock it was handed.
The bundler gives the kit the instant bundle evaluation began without saying
which clock it is on; this kit assumed the wall clock, but on Hermes it is the
monotonic one — so the reading published the instant the DEVICE BOOTED, rated
"poor", on every install. The clock is now tested; where both ends cannot be
shown to share one, or the result exceeds any launch, the axis reports no
reading rather than a verdict. Stored readings are withheld while apps update.

1.0.0-alpha.223 — The panel's Diagnosis section now says how many screens it
is not showing. It has always drawn the worst eight and stopped there, so a
developer with twenty measured screens read eight as the whole app. The count
is of screens that REPORTED a reading to the kit; nothing here reads your
navigator, and nothing says how many screens your app has.

1.0.0-alpha.222 — The bundled terms now state which kits your project needs.
When you ask the Boosthis connection which kits a project needs, or
deliberately send the hosted scanner's answer, Boosthis remembers the kit
names it worked out — the names only, from its own published list, kept for
365 days after they were last given — so your project row can show the
languages that are not reporting yet. This kit sends nothing new for it and
is unchanged apart from the legal documents it carries.

1.0.0-alpha.221 — Screens now measure themselves. Mount
<BoosthisNavigationObserver> once at your app root — the line the screen map
already asks for — and every screen change produces its own reading, with no
per-screen code. A screen that calls useBoosthis() is unchanged and is
measured ONCE: your own call is the reading that counts, and the automatic
path stands down for that screen rather than filing a second one beside it.
Parts the observer cannot see — a modal, a drawer, a wizard step that never
changes route — stay yours to measure, and the kit now says which is which.
Every reading records which of the two produced it. Long tasks, rage taps and
the per-sample frame and heap readings now name the screen they were taken
on, or say "no screen was current" rather than being blamed on the last
screen seen. Screen names stay on the device, as they always have.

1.0.0-alpha.220 — The bundled terms now state the register of a project's
parts. Boosthis keeps one list per project of the route and screen names it
has been observed to have, pooled across a project's installs so replacing an
install no longer restarts a part's history, and each entry is kept for 180
days after that part was last seen. Nothing new is sent for it: it is built
from the labels already on the performance readings this kit uploads, and
never from the route inventory this kit declares. The kit itself is unchanged
apart from the legal documents it carries.

1.0.0-alpha.219 — One rule now decides what a screen is called, shared with
every other Boosthis kit. This kit held two numbers at once: the route
inventory dropped a screen name over 80 characters while the page map
truncated at 120, so a ninety-character screen existed as an observed screen
and never reached the inventory — one kit disagreeing with itself about
whether that screen existed. Both halves now take one rule at 100 characters,
the same bound the server enforces, and an over-long name is refused rather
than shortened so two screens differing only past it stay two screens.

1.0.0-alpha.218 — The kit now says where it keeps its install id and whether
that place survives a relaunch. `@react-native-async-storage/async-storage` is
an OPTIONAL peer dependency: without it the kit falls through to an in-memory
map, with no error, and loses the credentials issued to it — so every launch
registers a brand-new install under the same project key. On every consent the
kit now sends which store it landed on (`device`, `memory`, or `unknown`) and
whether this launch read its identity state back. Your dashboard, the
connection check and the in-app panel each say what that costs, and the install
guide no longer claims device storage unconditionally. Nothing else this kit
measures or sends changes.

1.0.0-alpha.217 — Fixes the on-device screen diagnosis, which threw instead
of scoring. The perception helper it calls was never imported, so a host that
loads the kit as ES modules hit a reference error the first time a screen was
diagnosed. No reading changes its meaning, and nothing here touches the Speed
score.

1.0.0-alpha.216 — Three additive readings now cover manually marked background
work, dependency cache verdicts seen by traceFetch, and unhandled promise
rejection pressure. Short observation windows stay pending, missing cache or
cadence evidence stays blank rather than becoming zero, and Hermes explicitly
says when late handling cannot be distinguished. None of these readings changes
the Speed score.

1.0.0-alpha.215 — The kit no longer makes your bundler complain about
itself. Metro reported three require cycles among the kit's own modules on
every build you ran, printed in your terminal before the kit had measured
anything. The cause was that the scoring helpers every meter uses lived in
the same module that collects all the meters, so each meter pointed back at
the thing collecting it. Those helpers now live in a module of their own
that imports nothing at all. The warnings were not only untidy: a module
caught half-evaluated hands its neighbour values that are still undefined,
with nothing thrown and nothing logged. Nothing your app sees changes —
every meter reports exactly what it reported before.

1.0.0-alpha.214 — The kit now reports a screen that mounts an entire
collection at once. A scroll container handed more than 40 children in one
commit — the shape you get writing a list as
`<ScrollView>{items.map(...)}</ScrollView>` instead of a virtualised list —
is reported as a finding that names the screen, and it is read off the
element tree as that tree is built, so it still works in a release build
where React's render profiler is switched off and reports nothing. Only the
number of children is read: no row content, no prop value, nothing about
anyone using the app. The advice carries its consequence with it — a
virtualised list recycles rows, so per-row state kept inside a row must be
lifted out or it will revert.

1.0.0-alpha.213 — The in-app “Connect your AI” card now says what happens to
the install_id + read_token pair it shows when the app registers a new install
id. That pair is pinned to one install, so an app that cannot carry its stored
identity across a launch leaves an AI assistant reading the abandoned
install's last stored numbers — a 200 answer that looks live. The card now
names the durable account-wide token that survives a new install id, says
where to get it, and labels the pair it shows as one that dies with this
install. Nothing this kit measures, sends or stores changes.

1.0.0-alpha.212 — The diagnosis no longer throws on a host that loads the
kit as ES modules. A lazy require() sat inside the per-screen loop, so the
first app to record a per-screen phase ladder outside Metro lost its whole
performance snapshot rather than one score — the error surfaced from
getReport(), which the snapshot capture calls. It was invisible for as long
as no screen was scorable, because a loop with nothing to iterate never
reaches its own body. The module is now a static import, which is safe
because it refers back to the diagnosis only through types.

1.0.0-alpha.211 — Four readings are no longer graded: how long the app was in
the foreground, how often the screen rotated, how often the theme changed, and
how many memory warnings the operating system sent. Those score what the person
and the device did, not the app — a phone left in a pocket read as a red 0 out
of 100 and no change to your app could move it. The numbers still ship; only
the score and its bands are gone. Return-from-background recovery is still
graded: that one is your app's own resume work. Warm-up now waits on foreground
time rather than wall time, so a reading can no longer open on time the app
spent in the background, and how long we actually watched the app now moves the
snapshot's confidence instead of a score of its own.

1.0.0-alpha.210 — The automatic network wrapper now hands your app back the
very promise its transport returned, rather than a derived one. Watching a
request settle is not the same as replacing it: the wrapper used to return
`promise.then(...)`, which is a DIFFERENT object, so anything your transport
hung on the promise it made — an abort handle, a `cancel` method, a progress
property — was missing from the object your code received. The kit now
observes the original and returns that same object. It adds one thing to it: a
non-enumerable marker under `Symbol.for("boosthis.automaticAttempt")`, so the
kit can recognise its own attempt if you also measure by hand. Being
symbol-keyed it cannot collide with any string-named property of yours — it is
a registered symbol, so the same `Symbol.for` key reads it if you ever want to,
and a property you put there yourself is left as you set it — and
`JSON.stringify`, `Object.keys` and `for...in` do not see it. Its observer also
swallows what it sees, so a failed
request no longer raises a second, unhandled rejection from inside the kit;
your own call still rejects with exactly the error your transport threw. This
affects apps using `autoWrapNetwork` or `wrapNetworkFetch` only, and nothing
about what is measured or sent has changed.

1.0.0-alpha.209 — The Network reading no longer needs you to write the
wiring. Pass `autoWrapNetwork: true` to enableTelemetry and the kit reports
this app's own requests by itself — a duration and a coarse outcome, exactly
as before, with still no field anywhere for a URL, host, path or status. It
covers both transports the kit can reach from JavaScript — the global fetch
and XMLHttpRequest, which is what React Native's own fetch runs on — and a
transport your app imports and calls directly, such as expo/fetch, is
measured by wrapping it once with wrapNetworkFetch. Boosthis's own uploads
are never counted as your app's traffic. It re-asserts itself so a shim your
app installs afterwards cannot quietly switch it off, and a call you time
yourself with measureNetworkAttempt is counted once, not twice.
recordNetworkAttempt is unchanged and records exactly what you hand it, so
keep it for transports the kit cannot see: a call it reports that already
went out through a wrapped transport is counted twice, because a duration
and an outcome word cannot say which request they belong to. Where a
transport is present and cannot be reached, the kit
now sends that count rather than letting those calls disappear into a
measured figure. Nothing changes for an app that does not ask for it: the
reporting API is untouched and this is off by default.

1.0.0-alpha.208 — The existing JavaScript timer wrappers now report event-loop
lag, blocking timer arrivals and slow wrapped callbacks. All three readings
observe work the app already scheduled; they add neither a timer nor another
global wrapper, stay absent through their contract warm-up, and remain
display-only.

1.0.0-alpha.207 — An expired access answer no longer silences a copy of the
kit that never registered. Registration is the only way back from an expired
answer, and the same check stood in front of it, so an install holding no
credentials could be left unable to register — and it reported that as the
Boosthis API being unreachable when nothing had been sent. An expired answer
now silences only the install that earned it, which can check in and recover.

1.0.0-alpha.206 — The README shipped beside this kit was wrong twice over. It
still called itself 1.0.0-alpha.204, two releases behind the code in the same
download, so the notes for those releases were invisible to anyone reading the
file rather than the dashboard; and the whole document appeared a second time
further down, that copy claiming a third, older version. It now appears once
and states the version the kit ships. No code changed, and nothing this kit
measures, sends or shows is affected.

1.0.0-alpha.205 — The terms that ship beside this kit now describe the free
trial as it really works: it takes no payment card, nothing is charged to
start it, the limit is one per account and per confirmed email address, and on
the last day it simply ends rather than charging anything. Nothing this kit
measures, sends or shows has changed — the code is identical to
1.0.0-alpha.204. It is a release rather than a quiet correction because a
corrected document only reaches an installed kit when the version moves.

1.0.0-alpha.204 — The phone's memory and collection readings now use the shared
names, units and bands for Hermes heap headroom, collection pressure and its
recent tax, memory warnings and screen leaks. When Hermes or the phone cannot
expose a reading, the kit now declares the reason instead of showing a zero or
leaving it blank.

1.0.0-alpha.202 — Storage speed and storage failures now say where they
were taken. Both readings come from this app's own AsyncStorage on the
phone or tablet the app is installed on, and they now travel with that
fact attached, so your dashboard says the reading was measured on this
device rather than leaving you to guess whether it describes the handset,
a server or a shared disk. The numbers themselves are unchanged. Boosthis
names these readings the same way everywhere now — on the dashboard, on
the kit's own page and to an AI reading your project — and the same wave
gave the server kits the host readings a phone has no equivalent of: disk
pressure, storage I/O, page faults, file descriptors and system load. This
kit does not take those, and your dashboard shows the reason it cannot
rather than a zero.

1.0.0-alpha.201 — Documentation only — no code in this kit changed. The
Terms this kit ships with now list every cookie the Boosthis web dashboard
sets, rather than two of them. The old wording said the dashboard set "only"
a sign-in session and a short-lived one-time-code cookie; it has for some
time also set which workspace you are viewing, which environment you last
chose, a short-lived cookie for the code step that confirms a billing
change, and one that carries a team invitation through sign-in. A marker set
only in a browser signed in as a Boosthis administrator is listed too. None
of this is new behaviour and none of it affects your app — the sentence was
wrong and is now derived from the list the dashboard actually sets.

1.0.0-alpha.200 — The README that ships beside this kit now states the version
you are actually running. The copy inside the kit you download had stood at
1.0.0-alpha.149 since the day it was written — fifty releases — and its
changelog ended there, so the file beside the code named a kit nobody has run
for months. It now states the current version and carries the most recent
entries. Nothing this kit measures, sends or shows has changed — the code is
identical to 1.0.0-alpha.199. It is a release rather than a quiet correction
because a corrected file only reaches an installed kit when the version moves;
at an unchanged version every consumer is told it is already current, and the
fix never arrives.

1.0.0-alpha.199 — The kit no longer says measuring has started just because
Boosthis confirmed the install. A confirmation is permission, not a reading,
and announcing one as the other sent a developer hunting a fault that was not
there while our own server correctly reported the same install as never having
measured anything. The line now says what a confirmation actually proves, and
what produces a reading: one is taken when a page view or screen finishes.
Every Boosthis kit that carries this line was corrected together, so a phone
log and a browser log still read the same.

1.0.0-alpha.198 — The image-weight reading now measures images in an ordinary
app. It watched only the older way React creates elements, and every app built
with React Native's current settings creates them the newer way, so the
reading was switched on, reported itself installed, and never saw a single
image. It now watches both, which is why this reading was blank on every
install until today. Separately, the six frame-based readings (smoothness,
stability, idle efficiency, frame floor, frozen frames and app hangs) no
longer say "not available here" merely because the frame sampler is not
running: a kit that has not started and one that forget() has erased are both
stopped, and neither is a fact about the phone. That answer now needs a look
that found no frame source at all. Nothing new is collected or sent.

1.0.0-alpha.197 — Three readings could still call a host incapable on no
evidence. The bridge-traffic, image-weight and re-render readings decided "not
available here" from their own "not started" flag, which is equally true of a
kit that booted a second ago and one that forget() has just erased — so a
fresh app could be told a reading would never arrive. Each now says that only
after looking: the bridge spy surface was required and absent, the image
surface was there to wrap and was not, or a profiled screen rendered, the
person used it, and React still reported no commit (which only a release build
does). Every other state stays the temporary word, and teardown withdraws the
claim so the next install looks again. Nothing new is collected or sent.

1.0.0-alpha.196 — Meters that could never produce a score now say so instead
of saying "measuring…" for ever. Fifteen readings on this kit had no way to
report that a reading cannot be taken on a particular host, so a permanent
silence was shown as a temporary one. Each of those readings can now answer
"not available here" with a reason, and only when it has actually looked and
found the host surface missing — before the kit starts, and after forget()
erases it, the answer stays the temporary one, because nothing has been
checked. Separately, the memory-warning, unhandled-error and promise-rejection
rates no longer divide by the frame clock, which is empty on a host that draws
no frames; they now use the longer of the foreground clock and the frame
clock, so those three score on hosts where they previously could not. Nothing
new is collected, and nothing is sent that was not sent before.

1.0.0-alpha.195 — Documentation only. The bundled copy of the terms is
refreshed: the tax clause now says what the pricing pages say. Fees are
charged in Saudi Riyal, the SAR figure shown at purchase is the total amount
taken from the card, and a dollar figure shown beside it is an indicative
conversion at a fixed rate that your own card issuer redoes at its own rate.
No price changed. Nothing this kit measures, sends or stores is different in
this release.
-->

Source-of-truth workspace package for the React Native runtime that publishes to npm as `boosthis-runtime`.

Ported from the battle-tested Rival perf system. See `replit.md` for product context and `threat_model.md` for security guarantees.

## Structure

- `src/perfPlatform.ts` — Platform adapter (RN / web / Node fallback)
- `src/perfBoot.ts` — Cold-start ladder (bundleLoaded → rootRendered → firstScreen → interactive)
- `src/perfMonitor.ts` — Singleton event store + `makeScreenTimer` + `frameSampler` + `longSession`
- `src/perfNovelDetectors.ts` — Ghost mount, thundering herd, stranded interval, perception-adjusted score
- `src/perfSnapshots.ts` — AsyncStorage-backed snapshot store with diff + chronic-pattern detection
- `src/perfDiagnose.ts` — Pattern classifier (heavy mount / post-mount stall / list jank / boot waterfall / …)
- `src/perfProdSampler.ts` — Opt-in production telemetry (10% sample, 30s batch)
- `src/hooks/` — `useBoosthis`, `usePhaseTracker`, `useFidSampler`, `useLongSessionDiagnostic`
- `src/index.ts` — Public barrel
