package app.jellyflix.tv.data

/**
 * Two ways to keep a video from playing on and on when nobody is watching: "Are you still watching?" after a number of titles that
 * followed one another by themselves, and a sleep timer. The same rules as the web client's `core/watchLimit.ts`.
 *
 * - **The count** is the titles of one run: the one a person started (1) and each one that then began by itself. It is only trusted
 *   for the title that began by itself (see the view model): a title started by hand begins a new count.
 * - **At the limit** the next title does not begin; a question is shown. "Keep watching" starts it (and a new count), "Stop" or no
 *   answer in a minute stops.
 * - **The sleep timer** stops after a time chosen, or when the title now playing ends, and wins over the next title.
 * - With the limit off and no timer nothing here changes how autoplay works.
 */

/** After how many titles in a row the question comes. */
enum class StillWatching(val count: Int) {
    Off(0),
    After2(2),
    After3(3),
    After4(4),
    After6(6),
    After8(8),
}

/** Milliseconds the question waits for an answer before the playback stops. */
const val STILL_WATCHING_ANSWER_MS = 60_000L

val SLEEP_MINUTES = listOf(15, 30, 45, 60, 90, 120)

/** The timer says it is about to stop this long before, with a way to keep watching. */
const val SLEEP_WARNING_MS = 30_000L

sealed interface SleepTimer {
    /** Stop at a moment (ms since the epoch). */
    data class At(val endsAt: Long) : SleepTimer

    /** Stop when the title now playing ends. */
    data object EpisodeEnd : SleepTimer
}

fun sleepAfterMinutes(minutes: Int, now: Long): SleepTimer = SleepTimer.At(now + minutes * 60_000L)

enum class SleepState { Running, Warning, Due }

fun sleepState(timer: SleepTimer.At, now: Long): SleepState {
    val left = timer.endsAt - now
    return when {
        left <= 0 -> SleepState.Due
        left <= SLEEP_WARNING_MS -> SleepState.Warning
        else -> SleepState.Running
    }
}

sealed interface EndDecision {
    /** Start nothing: the timer says to stop here. */
    data object Stop : EndDecision

    /** Ask "Are you still watching?" before the next title. */
    data object Ask : EndDecision

    /** Start the next title by itself; [count] is the run's count to carry to it. */
    data class Continue(val count: Int) : EndDecision
}

/**
 * A title has ended and the next one is about to begin by itself. [count] is the titles of the run so far, counting the one that
 * ended; [limit] is "after how many titles" (0: never).
 */
fun decideAtEnd(count: Int, limit: Int, timer: SleepTimer?, now: Long): EndDecision {
    // The timer first: it stops the title that is ending, with no question and no next title.
    if (timer is SleepTimer.EpisodeEnd) return EndDecision.Stop
    if (timer is SleepTimer.At && now >= timer.endsAt) return EndDecision.Stop
    if (limit > 0 && count >= limit) return EndDecision.Ask
    return EndDecision.Continue(count + 1)
}
