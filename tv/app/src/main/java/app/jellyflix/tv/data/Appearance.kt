package app.jellyflix.tv.data

import androidx.annotation.StringRes
import app.jellyflix.tv.R
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * How the TV looks: a background (the canvas and the surfaces on it), an accent colour, how big the posters are and which rows the
 * Home has, in what order. The colours come from one place, so no screen has colours of its own. This is the web client's theme made
 * for a remote: the same six backgrounds and eight accents (no free colour: nobody types a hex code with a remote), and every pair is
 * tested for contrast. Colours are "#rrggbb" text here, so the rules can be tested without Android.
 */

// ---- Colour maths ---------------------------------------------------------------------------------------------------------

private fun parseHex(input: String): IntArray? {
    var text = input.trim()
    if (Regex("^#[0-9a-fA-F]{3}$").matches(text)) text = "#" + text.substring(1).map { "$it$it" }.joinToString("")
    if (!Regex("^#[0-9a-fA-F]{6}$").matches(text)) return null
    val n = text.substring(1).toInt(16)
    return intArrayOf((n shr 16) and 255, (n shr 8) and 255, n and 255)
}

fun isHexColor(input: String): Boolean = parseHex(input) != null

private fun toHex(r: Double, g: Double, b: Double): String {
    fun part(v: Double) = Math.round(min(255.0, max(0.0, v))).toInt().toString(16).padStart(2, '0')
    return "#${part(r)}${part(g)}${part(b)}"
}

private fun rgbToHsl(rgb: IntArray): DoubleArray {
    val r = rgb[0] / 255.0
    val g = rgb[1] / 255.0
    val b = rgb[2] / 255.0
    val hi = max(r, max(g, b))
    val lo = min(r, min(g, b))
    val l = (hi + lo) / 2
    if (hi == lo) return doubleArrayOf(0.0, 0.0, l)
    val d = hi - lo
    val s = if (l > 0.5) d / (2 - hi - lo) else d / (hi + lo)
    val h = when (hi) {
        r -> (g - b) / d + if (g < b) 6 else 0
        g -> (b - r) / d + 2
        else -> (r - g) / d + 4
    }
    return doubleArrayOf(h * 60, s, l)
}

private fun hslToHex(h: Double, s: Double, l: Double): String {
    val hue = (((h % 360) + 360) % 360) / 360
    if (s == 0.0) return toHex(l * 255, l * 255, l * 255)
    val q = if (l < 0.5) l * (1 + s) else l + s - l * s
    val p = 2 * l - q
    fun channel(t: Double): Double {
        val x = if (t < 0) t + 1 else if (t > 1) t - 1 else t
        return when {
            x < 1.0 / 6 -> p + (q - p) * 6 * x
            x < 1.0 / 2 -> q
            x < 2.0 / 3 -> p + (q - p) * (2.0 / 3 - x) * 6
            else -> p
        }
    }
    return toHex(channel(hue + 1.0 / 3) * 255, channel(hue) * 255, channel(hue - 1.0 / 3) * 255)
}

fun lightnessOf(color: String): Double = parseHex(color)?.let { rgbToHsl(it)[2] } ?: 0.0

fun withLightness(color: String, lightness: Double): String {
    val rgb = parseHex(color) ?: return color
    val hsl = rgbToHsl(rgb)
    return hslToHex(hsl[0], hsl[1], min(1.0, max(0.0, lightness)))
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
fun relativeLuminance(color: String): Double {
    val rgb = parseHex(color) ?: return 0.0
    fun lin(v: Int): Double {
        val c = v / 255.0
        return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). Normal text needs 4.5. */
fun contrastRatio(a: String, b: String): Double {
    val la = relativeLuminance(a)
    val lb = relativeLuminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
}

/** Raises the lightness of [color] until it reaches [ratio] against [against] (or gives up near white). */
private fun liftUntil(color: String, against: String, ratio: Double): String {
    var l = lightnessOf(color)
    var out = color
    while (contrastRatio(out, against) < ratio && l < 0.97) {
        l += 0.02
        out = withLightness(color, l)
    }
    return out
}

private const val TEXT_CONTRAST = 4.5

// ---- Backgrounds ----------------------------------------------------------------------------------------------------------

/** One background: the canvas ([bg]) and the surfaces that sit on it, from the lowest to the highest, and the colour of secondary text. */
data class Canvas(
    val id: String,
    @StringRes val label: Int,
    val bg: String,
    val surface: String,
    val surface2: String,
    val surface3: String,
    val muted: String,
) {
    /** What a surface turns into when it has the remote's focus or is lifted (a step lighter than [surface3]). */
    val surface4: String get() = withLightness(surface3, lightnessOf(surface3) + 0.04)
}

val CANVASES: List<Canvas> = listOf(
    // The original look of the TV: neutral greys on pure black.
    Canvas("black", R.string.canvas_black, "#000000", "#111111", "#151515", "#1c1c1c", "#b3b3b3"),
    Canvas("charcoal", R.string.canvas_charcoal, "#0d0d0f", "#141416", "#1b1b1f", "#232328", "#9c9ca6"),
    Canvas("midnight", R.string.canvas_midnight, "#050813", "#0a0f1f", "#101730", "#172040", "#8f9bbd"),
    Canvas("dusk", R.string.canvas_dusk, "#0a0712", "#100c1c", "#17122a", "#201a38", "#9d97b6"),
    Canvas("pine", R.string.canvas_pine, "#040a08", "#09120f", "#0f1b16", "#162620", "#8fa89e"),
    Canvas("cocoa", R.string.canvas_cocoa, "#0b0807", "#130e0c", "#1b1512", "#251d19", "#a69c94"),
)

const val DEFAULT_CANVAS = "black"

fun canvasOf(id: String): Canvas = CANVASES.firstOrNull { it.id == id } ?: CANVASES.first()

// ---- Accents --------------------------------------------------------------------------------------------------------------

data class AccentPreset(val id: String, @StringRes val label: Int, val color: String)

val ACCENTS: List<AccentPreset> = listOf(
    AccentPreset("ocean", R.string.accent_ocean, "#4d8dff"),
    AccentPreset("violet", R.string.accent_violet, "#a878ff"),
    AccentPreset("aqua", R.string.accent_aqua, "#2fd0ee"),
    AccentPreset("emerald", R.string.accent_emerald, "#34d399"),
    AccentPreset("amber", R.string.accent_amber, "#fbbf24"),
    AccentPreset("ember", R.string.accent_ember, "#ff8a3d"),
    AccentPreset("rose", R.string.accent_rose, "#fb7185"),
    AccentPreset("silver", R.string.accent_silver, "#d4d4dc"),
)

const val DEFAULT_ACCENT = "ocean"

/** The text and icons on a filled accent: near-black, like the TV has always had, so the accent itself is made light enough for it. */
const val ACCENT_INK = "#0b0e17"

/** A background and an accent: a preset id, or (from a backup made by the web client) a colour as "#rrggbb". */
data class ThemeChoice(val canvas: String = DEFAULT_CANVAS, val accent: String = DEFAULT_ACCENT)

/** The colour behind an accent choice (for showing a swatch). */
fun accentColor(accent: String): String =
    ACCENTS.firstOrNull { it.id == accent }?.color ?: parseHex(accent)?.let { toHex(it[0].toDouble(), it[1].toDouble(), it[2].toDouble()) } ?: ACCENTS.first().color

/** Cleans up whatever was saved or imported: an unknown background or a broken colour falls back to the default. */
fun sanitizeTheme(canvas: String?, accent: String?): ThemeChoice {
    val c = if (CANVASES.any { it.id == canvas }) canvas!! else DEFAULT_CANVAS
    val a = when {
        accent == null -> DEFAULT_ACCENT
        ACCENTS.any { it.id == accent } -> accent
        isHexColor(accent) -> accentColor(accent)
        else -> DEFAULT_ACCENT
    }
    return ThemeChoice(c, a)
}

/** Every colour a screen draws with. */
data class ThemeColors(
    val bg: String,
    val surface: String,
    val surface2: String,
    val surface3: String,
    val surface4: String,
    val muted: String,
    /** Text, icons, the focus ring and filled things: readable on every surface of the canvas. */
    val accent: String,
    /** Text and icons drawn on the accent. */
    val ink: String,
)

/** Works out the colours of a choice. The accent is lifted until it reads on the canvas and carries [ACCENT_INK] at 4.5:1. */
fun resolveTheme(choice: ThemeChoice): ThemeColors {
    val canvas = canvasOf(choice.canvas)
    val base = accentColor(choice.accent)
    val onCanvas = liftUntil(base, canvas.surface4, TEXT_CONTRAST)
    val accent = liftUntil(onCanvas, ACCENT_INK, TEXT_CONTRAST)
    // Secondary text has to read on the lifted surface too.
    val muted = liftUntil(canvas.muted, canvas.surface4, TEXT_CONTRAST)
    return ThemeColors(canvas.bg, canvas.surface, canvas.surface2, canvas.surface3, canvas.surface4, muted, accent, ACCENT_INK)
}

// ---- Poster size ----------------------------------------------------------------------------------------------------------

/** How big the posters are in rows and grids; the grids fit as many columns as that leaves room for. */
enum class PosterSize(val scale: Float, val columnsOffset: Int, @StringRes val label: Int) {
    Compact(0.85f, 1, R.string.poster_compact),
    Comfortable(1f, 0, R.string.poster_comfortable),
    Large(1.2f, -1, R.string.poster_large),
}

// ---- Home rows ------------------------------------------------------------------------------------------------------------

/**
 * The parts of the Home below the banner. The names are the web client's, so a backup made there can be read here (its "music" row
 * does not exist on the TV; the TV's "favorites" row is unknown to the web, which leaves it out).
 */
enum class HomeRow(val id: String, @StringRes val label: Int) {
    Discover("discover", R.string.discover_title),
    Continue("continue", R.string.row_continue),
    NextUp("nextUp", R.string.row_next_up),
    NewSinceVisit("newSinceVisit", R.string.row_since_visit),
    Upcoming("upcoming", R.string.row_coming_up),
    WatchLater("watchLater", R.string.row_watch_later),
    Playlists("playlists", R.string.row_playlists),
    Because("because", R.string.row_because_short),
    LatestMovies("latestMovies", R.string.row_new_movies),
    Favorites("favorites", R.string.row_favorites),
    Collections("collections", R.string.row_collections),
    NewSeries("newSeries", R.string.row_new_series),
    NewAnime("newAnime", R.string.row_new_anime),
    NewMusicVideos("newMusicVideos", R.string.row_new_music_videos),
    NewBooks("newBooks", R.string.row_new_books);

    companion object {
        fun of(id: Any?): HomeRow? = entries.firstOrNull { it.id == id }
    }
}

/** The banner (on or off) and the rows below it: their order, and the ones turned off. A row the account has no library for is left out by the page whatever is chosen. */
data class HomeLayout(
    val banner: Boolean = true,
    val order: List<HomeRow> = HomeRow.entries,
    val hidden: Set<HomeRow> = emptySet(),
) {
    /** The rows to draw, in order. */
    val visible: List<HomeRow> get() = order.filter { it !in hidden }

    val isDefault: Boolean get() = banner && hidden.isEmpty() && order == HomeRow.entries

    fun toggled(row: HomeRow): HomeLayout = copy(hidden = if (row in hidden) hidden - row else hidden + row)

    /** Moves a row one place up (-1) or down (+1); at the end it stays where it is. */
    fun moved(row: HomeRow, direction: Int): HomeLayout {
        val from = order.indexOf(row)
        val to = from + direction
        if (from < 0 || to < 0 || to >= order.size) return this
        val list = order.toMutableList()
        val moving = list[from]
        list[from] = list[to]
        list[to] = moving
        return copy(order = list)
    }

    companion object {
        /**
         * Cleans up whatever was saved: unknown and repeated rows are dropped, rows the saved copy has never heard of (added in a later
         * version) are appended after the ones it knows, and nothing else changes.
         */
        fun sanitized(banner: Any?, order: List<Any?>?, hidden: List<Any?>?): HomeLayout {
            val rows = LinkedHashSet<HomeRow>()
            order?.forEach { id -> HomeRow.of(id)?.let(rows::add) }
            rows.addAll(HomeRow.entries)
            return HomeLayout(
                banner = banner != false,
                order = rows.toList(),
                hidden = hidden.orEmpty().mapNotNull { HomeRow.of(it) }.toSet(),
            )
        }
    }
}

// ---- Top bar buttons ------------------------------------------------------------------------------------------------------

/** What the buttons of the top bar show. [id] is the web client's word for it, so a look saved on one can be loaded on the other. */
enum class NavStyle(val id: String, @StringRes val label: Int) {
    Full("full", R.string.nav_style_full),
    Icons("icons", R.string.nav_style_icons),
    Text("text", R.string.nav_style_text);

    companion object {
        fun of(id: String?): NavStyle = entries.firstOrNull { it.id == id } ?: Full
    }
}

/** About how wide (dp) a top bar button is: its padding, the picture, the gap and roughly 8.5dp a letter. */
fun navButtonWidth(name: String, style: NavStyle): Float = when (style) {
    NavStyle.Icons -> 44f
    NavStyle.Text -> 36f + name.length * 8.5f
    NavStyle.Full -> 36f + 22f + 8f + name.length * 8.5f
}

/** The gap between the buttons of the top bar (dp). */
const val NAV_GAP = 8f

/**
 * What the buttons really show: what was chosen, except that pictures with names make way for the pictures alone when the names
 * do not fit in [availableDp]. With only the names, the bar scrolls instead.
 */
fun navStyleFor(chosen: NavStyle, names: List<String>, availableDp: Float): NavStyle {
    if (chosen != NavStyle.Full) return chosen
    val need = names.sumOf { navButtonWidth(it, NavStyle.Full).toDouble() } + NAV_GAP * (names.size - 1).coerceAtLeast(0)
    return if (need <= availableDp) NavStyle.Full else NavStyle.Icons
}

// ---- Everything together --------------------------------------------------------------------------------------------------

data class Appearance(
    val theme: ThemeChoice = ThemeChoice(),
    val posters: PosterSize = PosterSize.Comfortable,
    val home: HomeLayout = HomeLayout(),
    val nav: NavStyle = NavStyle.Full,
) {
    /** The values as text, to be stored; [decode] reads them back and ignores anything it does not know. */
    fun encode(): Map<String, String> = mapOf(
        "canvas" to theme.canvas,
        "accent" to theme.accent,
        "posters" to posters.name,
        "banner" to home.banner.toString(),
        "rows" to home.order.joinToString(",") { it.id },
        "hidden" to home.hidden.joinToString(",") { it.id },
        "nav" to nav.id,
    )

    companion object {
        fun decode(read: (String) -> String?): Appearance {
            fun list(key: String) = read(key)?.split(',')?.filter { it.isNotBlank() }
            return Appearance(
                theme = sanitizeTheme(read("canvas"), read("accent")),
                posters = PosterSize.entries.firstOrNull { it.name == read("posters") } ?: PosterSize.Comfortable,
                home = HomeLayout.sanitized(read("banner")?.let { it == "true" }, list("rows"), list("hidden")),
                nav = NavStyle.of(read("nav")),
            )
        }
    }
}
