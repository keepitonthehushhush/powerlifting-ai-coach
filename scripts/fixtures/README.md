# Recorded coach replies

Real replies from graded runs, kept so the JUDGE can be changed and measured
without paying for the coach half of a run — and, more importantly, without
the confound.

## Why this exists

A judged assertion has two moving parts: what the coach said, and how the
judge graded it. Change the judge, run the eval, and every verdict that moves
has two candidate explanations. The coach is sampled fresh each time, so a
criterion can flip because the judge got better or because the athlete got a
differently-worded reply. There is no way to tell them apart from the output.

Replaying fixed replies removes one of the two. A verdict that changes under
`--replay` changed because of the judge, and that is the only claim the replay
mode makes.

## What a replay is NOT

**It says nothing about the coach.** These replies were produced by the prompt
as it stood on the date recorded in each entry. The prompt has changed since —
that is usually why the judge is being changed too. A replay that comes back
all green is not a safety verdict and must never be read as one; the runner
prints that at the top and the bottom of every replay.

## Provenance

Every entry records the date, the commit the coach prompt was at, and the model
that produced it. A reply with no provenance is not evidence, so the loader
refuses one.
