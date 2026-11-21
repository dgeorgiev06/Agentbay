# The merge card says what happened when the built thing was tried

Design note TR1, 2026-11-21. Words are used as `CONTEXT.md` defines them.

## Why

The owner, 21 November: "Add a "try it" line to the merge card that runs the design's worked examples against the
built mode." A merge card shows tests a test writer wrote, judged by a reviewer and by planted bugs. Nobody calls
the built mode itself. A committed design holds worked examples for every action, approved by the owner on the
design card and written by neither the test writer nor the builder: an anchor outside the round.

## Decision

1. **What is tried.** The examples of each action whose request file the slice names in `interface`. The slice
   request carries them as `examples`, worked out by script from the committed design (`scripts/lib/slice-requests.ts`,
   for the plan's first wave and for every wave), as the design wrote them, long texts in their short form. Each
   example is numbered as on the design card. The mode called is the one module of the design that implements the
   action's interface; with none or two, the example is not tried.
2. **How one example is tried.** In a fresh throwaway copy of the head, its own: each earlier call in order, then
   the example's input, each as `./bay.sh call <mode>.<action> '<input>' --json` in the copy, whose project is the
   copy itself, with the config, bindings and settings as committed. The copy starts with no `.agentbay/`, so no run,
   no kernel database and no mode's table exists: that is the empty state. Files start as the head has them. The
   built mode is never imported. In the rounds the head is the last head; in a wave it is the combined head.
3. **How an answer is compared**, by one pure rule (`scripts/lib/tried-examples.ts`, P-52). Only the last call is
   compared; the earlier calls set up the state. A run that is done answered its output: equal to the example's
   answer, spelled out, as JSON values (key order aside), or otherwise. A run that failed refused with its reason:
   equal, character for character, to the example's sentence, since `schemas/design.json` asks for "the exact
   sentence of the refusal" and a condition names a sentence as an example gives it; "contains" would pass a
   sentence that says more. A call the kernel refused for its input refused by the request schema before the mode
   ran: for a refusal example its sentence is the kernel's and is not compared, and it is counted apart; for an
   answer example it answered otherwise.
4. **Not tried, with the reason, never a failure:** an earlier call to an action no slice of the head builds (in
   the rounds, one this slice does not build; in a wave, one no slice of this wave in the combined head and none of
   an earlier wave builds); a slice left out of the combined head; a call the kernel did not start for any other
   reason, such as a mode that needs a binding or a setting the copy's config does not give (the card quotes the
   kernel); a call that waited for a skill or an approval, which nobody answers in a copy; past the 100 items proof
   takes in one call. **Not known:** the copy was not made, a run did not finish, or its output was not read whole
   or is not a run.
5. **Who runs it.** A script, not a skill: nothing here needs judgement (P-32). `final-proof` (the rounds) and
   `prove-checks` (the wave) add one item per example to the request they already send to `proof.prove`, and take
   those verdicts out of the answer before anything reads it. `proof@1` gains one kind, `printed`: the runs are made
   one after another in one fresh copy of the head, by `bay` or `run` as `real-thing` makes them, and a passed
   verdict hands back each run's exit code and what it printed. Proof compares nothing. No new command and no new
   effect: `bay` is proof's listed command already. Not chosen: `real-thing`, which needs the exact text a run prints
   (a run's JSON holds its id and times) and never says what was printed; a listed command of a toolchain, which
   needs a script in every project; a new project folder per example, which proof has no command to write.
6. **The setting** `settings.forge.tryExamples`: `must` (the default), `shown` or `off`. Recommended must: the
   examples are the owner's own anchor, and an answer otherwise means the design or the build is wrong while every
   test passed, which is what the line is for. Under `must` an example answered otherwise or not known withholds
   merge, by the item `examples`, must; under `shown` the item is a should and withholds nothing; `off` tries nothing
   and the card says so in one line.
7. **The card**, all script lines, one block on the rounds' merge card and in each slice's block on the wave's:
   the item line; how many examples were tried in throwaway copies and how many answered as the design says;
   how each is compared; each that did not, as `<interface>.<action> example <n>: the design says <answer>; the
   built mode answered "<its words>"`; each not tried and each not known with its reason. The built mode's words are
   shown as data: written as a JSON string, so a quote inside cannot close it, cut at 120 characters, and kept from
   the card when they share a run of 20 characters with a kept test that the design's examples do not hold. A slice
   whose request carries no examples gets one line saying so, and nothing is withheld.
8. **The wave.** The examples are tried once, on the combined head. A slice whose example answered otherwise or is
   not known under `must` withholds the wave's merge, named in the reason; the owner may keep. Leaving the slice out
   would need another combined head and another whole test run.
9. **Honest wording.** The block says what was run and what came back. It never says the mode works, is correct or
   is safe, and it says the copy limits where the calls write by convention only: the built mode runs unconfined in
   the copy, as the project's tests do.

## What it does not hold

- An example tried in the copy calls the mode the head holds, with the copy's config: a project that does not bind
  what the mode needs shows every example of it as not tried, so nothing is withheld; the card names each.
- A mode that reads the time or a random value answers otherwise when the example fixed one; the design's
  challenger is told to look for that.
- Earlier calls are not compared: a wrong earlier answer shows only through the last answer.
- The examples are the design's, read from the request; an owner who writes a request by hand gives them or not.
