# Cerebro — design direction

Locked before phase 5, revised when the palette changed to orange-red on black.
The dashboard is built to this, and the running app is the reference — there is
deliberately no second copy of the design system to drift out of date.

**Subject.** A self-hosted feature flag service for one engineering organization.
**Audience.** The developers and admins of that org — people who already know what
a flag is and need to see where each one stands. **The page's single job:** show
how far every flag has travelled through the promotion pipeline, and whether it is
live, without anyone having to read twice.

**It is an instrument panel, not a dashboard.** Someone opens this to answer
"what is on in production right now", often in a hurry, often because something is
wrong. It should read like equipment: dark, dense, legible at a glance, with one
colour that means *pay attention*.

---

## The idea: a flag is a line, not a row of cells

Spec §14 fixes two facts that drive everything visual:

1. **Promotion is a prefix.** Environments are ranked and promotion is sequential,
   so a flag is always promoted through an unbroken run starting at rank 0. There
   is no promoted-in-prod-but-not-qa. A flag's state across the pipeline is
   therefore a *length*, not three independent values.
2. **`state` and `enabled` are independent axes.** Promotion is structural,
   permissioned and ordered. Enabling is instantaneous and reversible.

A grid of independent pills — the obvious answer, and what every other flag tool
draws — actively misrepresents (1). So the matrix renders each flag as a **signal
line**: a rail running left to right through the environments in rank order, with
a node at each one.

- **Track laid** (solid, finely notched) = promoted. **Track ahead** (thin, sparse
  dots) = not yet. The two must never be mistakable for each other.
- The join between them is the **frontier** — the single most useful fact about a
  flag, read as a position rather than decoded from colours.
- **Node lit** = enabled here. **Node neutral** = promoted but off. **Node hatched
  out** = not promoted.

Reading a column still works — that is the matrix. Reading a row now tells you how
far the flag has shipped, at a glance and without counting.

---

## Colour

Orange-red on near-black. Everything else is a neutral step between them.

| Token | Hex | Role | On ground |
|---|---|---|---|
| `--void` | `#07090C` | Page. Ruled with a barely-there grid, like an instrument face | — |
| `--surface` | `#0F151B` | Panels — a lifted plane, never an outlined box | — |
| `--surface-2` | `#171F27` | Inputs, alternate rows | — |
| `--surface-3` | `#212C36` | Buttons, chips | — |
| `--ink` | `#EDF1F6` | Primary text | 17.6:1 |
| `--ink-dim` | `#8C99A8` | Labels, secondary text | 6.9:1 |
| `--signal` | `#FF7F6E` | The accent. Primary action, production, critical | 8.1:1 |

**Why not the raw brand red.** `#F45745` at full saturation on pure black
halates — the eye reads the bloom as glare rather than emphasis, and it tires
fast on a surface people stare at while something is broken. Two changes fix it
without losing the brand: lift the ground off pure black, which is what removes
the bloom, and lighten the accent slightly, which *raises* measured contrast
from 6.0:1 to 8.1:1. Dim text moved with it, 4.8:1 → 6.9:1. The one place the
accent still appears as a large fill is the single primary button per card,
where it carries near-black text at 8.1:1.

Environments are *ranked*, so their colours are a **ramp**, not three arbitrary
hues — and the ramp runs in HUD semantics, information → caution → critical, so a
flag visibly heats up as it approaches production:

| Rank | Token | Hex | |
|---|---|---|---|
| 0 | `--env-low` | `#5BE0D0` | information — 12.4:1 |
| middle | `--env-mid` | `#F5B655` | caution — 11.1:1 |
| last | `--env-high` | `#FF7F6E` | critical — the accent, 8.1:1 |

**Discipline.** Production is the accent, and the accent is the only colour with
any heat in it, so it must be spent carefully: one filled signal control per card,
and it marks *making a flag live* — the act that changes what users see.
Promotion is structural plumbing and gets a neutral button. Additional
environments interpolate along the ramp by rank, so inserting `staging` reshades
the whole line without a new token.

There is no light mode. This is an ops surface.

## Type

Three roles, strictly separated — the first version used the display face for
everything, which looked right in a screenshot and was tiring to actually read.

**Chakra Petch — the wordmark, and nothing else.** A display face: angular, with
cut corners that echo the interface's zero-radius geometry. That is exactly what
you want on a name and exactly what you do not want on a flag key at 13px.

> The original used **Cygnito Mono**, which is a commercial face — "all rights
> reserved", ATK Studio — so it cannot ship in a public repository. To use it, or
> any licensed face of your own, put the file in `apps/web/src/fonts/` (already
> gitignored) and swap the `Chakra_Petch(...)` call in `app/layout.tsx` for
> `localFont({ src: "../fonts/YourFont.otf", variable: "--font-display" })`.
> Nothing else changes — only `.wordmark` uses this variable.

**IBM Plex Sans — every label, button, badge, heading and description.** Chosen
for legibility at 11–15px, with three weights so hierarchy stops depending on
colour alone.

**IBM Plex Mono — anything a person might copy, diff or type:** flag keys, values,
JSON, config versions, key prefixes, audit actions, emails. It shares metrics with
Plex Sans, so mono and sans sit together on a line without a visible step.

The rule for deciding: *would someone paste this into a terminal?* Then it is
mono. Otherwise it is sans. A person's name is sans; their email is mono.

Scale, a step up from the first pass because a console is read at a glance:

| Role | Size |
|---|---|
| Page title | 27px, 600 |
| Flag key (list) | 15px mono, 500 |
| Flag name (list) | 14px sans |
| Body / prose | 16px |
| Fields | 15px |
| Buttons | 12px, uppercase, `0.09em` |
| Labels | 11px, uppercase, `0.16em` |

## Navigation

A **floating console rail** down the left, not a header. It detaches from the
edges, collapses to two-letter codes (`FL`, `AU`, `PI`) at 60px, and remembers
which state you left it in. A header would spend the most valuable strip of the
page on five links; the rail gives the full width back to the matrix, which is
the only thing anyone opened this to read.

## Geometry

**Nothing is outlined.** No borders on panels, inputs, chips or buttons.
Separation comes from filled planes, row striping, and space. Radius is zero
everywhere; the only curves in the interface are in the letterforms.

Three devices carry the retrofuturist read, each earning its place:

- **Corner ticks** — two small signal-coloured L marks on a panel's opposite
  corners. Framing without containment.
- **Diagonal hatching** — the universal "this exists but is not available to you".
  Used for disabled controls and for environments a flag has not reached, which is
  exactly the same idea.
- **The leading marker** — a short signal bar down the left of any flag that is
  live somewhere. Scanning the matrix for red bars answers "what is on right now".

Focus is a signal-coloured glow, never an outline.

## Signature

**The frontier.** The single point on each rail where laid track becomes dotted.
It is the answer to "how far has this shipped", and nothing else is allowed to
compete with it.

## Motion

One orchestrated moment: on load, rails lay themselves left to right in rank
order, 420ms, rows staggered 28ms; nodes arrive in three steps, like a readout
resolving. It re-enacts promotion, which is what the page is about. Nothing else
moves. `prefers-reduced-motion` renders the final state immediately.

## Copy

- Name what people control: **Promote to qa**, **Turn off in prod**, **Revoke key**.
  Never "submit", never "config".
- An action keeps its name through the whole flow: the button says *Promote to qa*,
  the result says *Promoted to qa*.
- Disabled controls say which permission is missing, not that they are disabled:
  *You need promote on prod.*
- Empty state is an instruction: *No flags yet. Create one in dev — every flag
  starts there and moves up.*
- Errors state the rule: *This flag must reach qa before prod.*
- Protected environments ask for the flag key by name: *Type `new-checkout` to
  turn this on in prod.*

---

## Notes for the next pass

- Verified on desktop in Chrome. The narrow-viewport rule — the rail rotates to a
  per-flag stack below 720px — is written but has **not** been visually confirmed.
- Component CSS lives in `@layer components`. Tailwind v4 puts utilities in a
  later layer, and unlayered CSS beats layered CSS regardless of specificity — so
  unlayered component classes silently defeat every utility you try to override
  them with. That cost a debugging round; leave the layer in place.
- The first pass at the laid track used heavy segmentation, which made laid and
  unlaid track look alike and destroyed the frontier. Laid track must stay
  visually solid.
