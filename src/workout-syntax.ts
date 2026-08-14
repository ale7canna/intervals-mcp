/**
 * The native intervals.icu workout text format, used in the `description` field of a
 * calendar event. intervals.icu parses it server-side into a structured `workout_doc`,
 * which is what gets pushed to Garmin / Wahoo / Zwift.
 */

/** Compact cheat sheet — inlined into tool descriptions so the model always sees it. */
export const WORKOUT_SYNTAX_CHEATSHEET = `intervals.icu workout syntax (goes in \`description\`, one step per line starting with "- "):
  STEP: - <duration|distance> <target> [cadence] [text cue]
  DURATION: 30s | 10m | 1h | 1h5m30s   (NB: "m" = minutes, "s" = seconds)
  DISTANCE: 400mtr | 2km | 1mi         (NB: use "mtr" for metres, never "m")
  POWER:   75% | 85-90% | 220w | 200-240w | Z2 | Z3-Z4 | 60% MMP 5m   (% = of FTP)
  HR:      70% HR (of max HR) | 95% LTHR | Z2 HR
  PACE:    85% Pace (of threshold pace) | Z3 Pace | 4:30/km Pace | 1:45/100m Pace
  RAMP:    - 10m ramp 50-75%
  FREE:    - 20m freeride            (no ERG / no target)
  CADENCE: append e.g. 90rpm or 85-95rpm
  CUE:     put free text BEFORE the duration: "- Stay relaxed 5m 80%".
           Text placed after the target is silently dropped.
  REPEATS: a line "4x" (blank line before and after) or a section header "Main set 4x"
  SECTIONS: separate blocks with a blank line; a line without "-" is the section name.
            Name them Warmup / Cooldown to flag warmup and cooldown.
Percentages resolve against the athlete's sport settings (FTP, LTHR, max HR, threshold
pace) at push time, so a workout written in % follows the thresholds automatically.`;

/** Full guide — exposed as an MCP resource and via the `workout_syntax_guide` tool. */
export const WORKOUT_SYNTAX_GUIDE = `# intervals.icu workout syntax

A planned workout is a calendar event with \`category: "WORKOUT"\` whose \`description\`
holds the workout in intervals.icu's plain-text format. intervals.icu parses the text into
a structured workout (\`workout_doc\`) and that structure is what gets uploaded to a paired
device (Garmin, Wahoo, Zwift, Coros, Suunto).

## Step lines

Every step is a line starting with \`- \`:

    - <duration or distance> <target(s)> [cadence] [text cue]

### Duration
| Form | Meaning |
|---|---|
| \`30s\` \`45"\` | seconds |
| \`10m\` \`10'\` | **minutes** (not metres) |
| \`1h\` | hours |
| \`1h5m30s\` | combined |

### Distance
| Form | Meaning |
|---|---|
| \`400mtr\` | metres — \`mtr\`, because \`m\` means minutes |
| \`2km\` \`2.5km\` | kilometres |
| \`1mi\` \`4.5mi\` | miles |

### Targets
| Kind | Examples | Resolves against |
|---|---|---|
| Power % | \`75%\` \`85-90%\` | FTP (indoor FTP for indoor rides) |
| Power abs | \`220w\` \`200-240w\` | — |
| Power zone | \`Z2\` \`Z3-Z4\` | power zones |
| MMP | \`60% MMP 5m\` | 5-minute mean maximal power |
| HR % | \`70% HR\` | max HR |
| LTHR % | \`95% LTHR\` | threshold HR |
| HR zone | \`Z2 HR\` | HR zones |
| Pace % | \`85% Pace\` | threshold pace |
| Pace zone | \`Z3 Pace\` | pace zones |
| Pace abs | \`4:30/km Pace\` \`7:00/mi Pace\` \`1:45/100m Pace\` | — |
| Ramp | \`10m ramp 50-75%\` | as above |
| Freeride | \`20m freeride\` | no target, ERG off |

Cadence goes after the target: \`- 10m 75% 90rpm\` or \`- 10m 75% 85-95rpm\`.

Free text before the duration becomes the on-screen cue: \`- Stay seated 5m 80%\`.
Order matters — text written *after* the target (\`- 5m 80% Stay seated\`) is parsed away
silently, so the step is created but the athlete never sees the note on the watch.
A step may also carry no target at all (\`- 60s Walk recovery\`), which is how you write a
free recovery between reps.

## Sections and repeats

Blocks separated by a blank line are sections. A line that does not start with \`-\` is the
section name; append \`Nx\` to repeat the whole section:

    Warmup
    - 10m ramp 50-70% 85rpm

    Main set 4x
    - 4m 105-110%
    - 3m 55%

    Cooldown
    - 10m 50%

A bare \`4x\` line (blank line before and after) repeats the steps that follow it.

## Running example (pace targets, Garmin-friendly)

    Warmup
    - 12m 70% Pace

    Main set 5x
    - 1km 100% Pace
    - 90s 60% Pace

    Cooldown
    - 8m 65% Pace

## Notes that matter for device upload

- Write targets in **%** (of FTP / LTHR / threshold pace) rather than absolute numbers when
  you want the workout to track the athlete's current thresholds — intervals.icu resolves
  them when it pushes to the device, using the sport settings for that activity type.
- Garmin needs a *range*, not a single number. intervals.icu widens fixed targets
  automatically using the ranges configured in its Garmin settings
  (\`icu_garmin_outdoor_power_range\`, \`icu_garmin_hr_range\`, \`garmin_pace_range\`).
- Distance-based steps (\`400mtr\`) are fine for runs; on indoor trainer workouts prefer
  time-based steps.
- **Pace targets need \`threshold_pace\` set for the sport, and power targets need \`ftp\` —
  even when the workout uses absolute values.** If the threshold is missing, intervals.icu
  drops those targets from the file it pushes to the device and every step arrives on the
  watch as "No Target", while \`workout_doc\` here still looks perfectly correct. Verified by
  decoding the generated FIT: with no Run threshold pace every step was \`target=open\`; after
  setting it, the same event exported \`target=speed\` with the right ranges.
  HR targets are unaffected as long as LTHR or max HR is set. Check with \`get_athlete\`.
- The upload to the device is triggered by a change to the event (or to the sport settings).
  Fixing a threshold alone may not re-push an event that was already uploaded — touch the
  event (e.g. re-save its description) to make the upload run again.
- Only the next few days of the calendar are pushed to Garmin, and the athlete must have
  "Upload planned workouts" enabled on the intervals.icu settings page.
`;
