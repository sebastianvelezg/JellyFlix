package app.jellyflix.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.Gate
import app.jellyflix.tv.R
import app.jellyflix.tv.data.MAX_PROFILES
import app.jellyflix.tv.data.PIN_MAX_DIGITS
import app.jellyflix.tv.data.PIN_MIN_DIGITS
import app.jellyflix.tv.data.PinResult
import app.jellyflix.tv.data.Profile
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What stands in front of the app while no account is open: the picker, the PIN, the sign-in, or a blank moment between two accounts. */
@Composable
fun GateScreen(vm: AppViewModel) {
    when (val gate = vm.gate) {
        Gate.Chooser -> ProfileChooser(vm)
        is Gate.Pin -> {
            val profile = vm.profiles.find(gate.id)
            if (profile == null) ProfileChooser(vm) else PinGate(vm, profile)
        }
        is Gate.SignIn -> {
            val profile = gate.profileId?.let { vm.profiles.find(it) }
            SignInScreen(
                initialServer = vm.lastServer,
                busy = vm.busy,
                quickCode = vm.quickCode,
                quickLink = vm.quickLink,
                quickExpiresAt = vm.quickExpiresAt,
                onQuickConnect = vm::startQuickConnect,
                onCancelQuickConnect = vm::cancelQuickConnect,
                error = vm.errorRes?.let { stringResource(it) } ?: vm.errorText,
                onSignIn = vm::signIn,
                fixedServer = gate.server,
                accountName = profile?.name,
                onBack = if (vm.profiles.isEmpty) null else vm::backToChooser,
            )
        }
        // Between two accounts: nothing of the one leaving is drawn while its player says where it stopped.
        Gate.Switching, Gate.Open -> Box(Modifier.fillMaxSize())
    }
}

// ---- "Who is watching?" ---------------------------------------------------------------------------------------------------

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ProfileChooser(vm: AppViewModel) {
    val profiles = vm.profiles.profiles
    var removing by remember { mutableStateOf<Profile?>(null) }
    val first = remember { FocusRequester() }
    val confirm = remember { FocusRequester() }
    LaunchedEffect(removing) { if (removing != null) confirm.requestFocusSoon() else first.requestFocusSoon() }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(R.string.profiles_title), fontSize = 34.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Spacer(Modifier.height(36.dp))
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterHorizontally),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            items(profiles, key = { it.id }) { profile ->
                ProfileTile(
                    profile = profile,
                    onOpen = { vm.choose(profile) },
                    onHold = { removing = profile },
                    modifier = if (profile.id == (vm.profiles.activeId ?: profiles.maxByOrNull { it.lastUsed }?.id)) Modifier.focusRequester(first) else Modifier,
                )
            }
            if (vm.profiles.canAdd) {
                item { AddTile(onClick = vm::addAccount) }
            }
        }
        Spacer(Modifier.height(24.dp))
        val target = removing
        if (target == null) {
            Text(
                stringResource(if (vm.profiles.canAdd) R.string.profiles_hint else R.string.profiles_full, MAX_PROFILES),
                fontSize = 14.sp,
                color = Palette.TextDim,
                textAlign = TextAlign.Center,
            )
        } else {
            Text(stringResource(R.string.profiles_remove_title, target.name), fontSize = 18.sp, color = Color.White)
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.profiles_remove_note),
                fontSize = 14.sp,
                color = Palette.TextDim,
                textAlign = TextAlign.Center,
                modifier = Modifier.width(560.dp),
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Pill(
                    stringResource(R.string.profiles_remove),
                    onClick = {
                        removing = null
                        vm.removeProfile(target.id)
                    },
                    accent = true,
                    modifier = Modifier.focusRequester(confirm),
                )
                Pill(stringResource(R.string.pin_cancel), onClick = { removing = null })
            }
        }
    }
}

/** A round picture (the account's own, or its initial when it has none), its name, and what is special about it. */
@OptIn(ExperimentalTvMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
private fun ProfileTile(profile: Profile, onOpen: () -> Unit, onHold: () -> Unit, modifier: Modifier = Modifier) {
    val note = when {
        profile.needsSignIn -> stringResource(R.string.profiles_sign_in_again)
        profile.hasPin -> stringResource(R.string.profiles_locked)
        else -> null
    }
    Surface(
        onClick = onOpen,
        onLongClick = onHold,
        modifier = modifier.width(150.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(18.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            focusedContainerColor = Palette.Surface3,
            contentColor = Color.White,
            focusedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
    ) {
        Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar(profile, size = 112)
            Spacer(Modifier.height(10.dp))
            Text(profile.name, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(
                note.orEmpty(),
                fontSize = 12.sp,
                color = if (profile.needsSignIn) Palette.Accent else Palette.TextDim,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.height(16.dp),
            )
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun AddTile(onClick: () -> Unit) {
    val label = stringResource(R.string.profiles_add)
    Surface(
        onClick = onClick,
        modifier = Modifier.width(150.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(18.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            focusedContainerColor = Palette.Surface3,
            contentColor = Color.White,
            focusedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
    ) {
        Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(112.dp).border(2.dp, Palette.TextDim, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("+", fontSize = 44.sp, color = Palette.TextDim)
            }
            Spacer(Modifier.height(10.dp))
            Text(label, fontSize = 18.sp, maxLines = 2, textAlign = TextAlign.Center)
            Spacer(Modifier.height(16.dp))
        }
    }
}

/** The account's picture on the server; the initial of its name sits behind it and shows when there is none. */
@Composable
fun Avatar(profile: Profile, size: Int) {
    Box(
        Modifier.size(size.dp).background(Palette.Accent.copy(alpha = 0.35f), CircleShape).semantics { contentDescription = profile.name },
        contentAlignment = Alignment.Center,
    ) {
        Text(profile.name.trim().take(1).uppercase(), fontSize = (size / 2.4f).sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        AsyncImage(
            model = profile.avatarUrl,
            contentDescription = null,
            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            modifier = Modifier.size(size.dp).clip(CircleShape),
        )
    }
}

// ---- PIN ---------------------------------------------------------------------------------------------------------------

/** Opening an account that has a PIN. A wrong PIN is counted; after a few the next try has to wait, and the wait is shown. */
@Composable
private fun PinGate(vm: AppViewModel, profile: Profile) {
    var attempt by remember { mutableIntStateOf(0) }
    var wrong by remember { mutableStateOf(false) }
    var wait by remember { mutableIntStateOf(profile.waitLeftSeconds(System.currentTimeMillis(), android.os.SystemClock.elapsedRealtime())) }
    // A PIN is being checked (off the main thread): the pad does not send another one meanwhile.
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(wait > 0) {
        while (wait > 0) {
            delay(1_000)
            wait -= 1
        }
    }
    PinScreen(
        title = stringResource(R.string.pin_title, profile.name),
        subtitle = stringResource(R.string.pin_open),
        error = when {
            wait > 0 -> stringResource(R.string.pin_wait, wait)
            wrong -> stringResource(R.string.pin_wrong)
            else -> null
        },
        attempt = attempt,
        onSubmit = { pin ->
            attempt += 1
            checking = true
            scope.launch {
                try {
                    when (val result = vm.checkPin(profile.id, pin)) {
                        PinResult.Right -> vm.unlock(profile.id)
                        is PinResult.Wrong -> {
                            wrong = true
                            wait = result.waitSeconds
                        }
                        is PinResult.Waiting -> {
                            wrong = false
                            wait = result.seconds
                        }
                    }
                } finally {
                    checking = false
                }
            }
        },
        onCancel = if (vm.profiles.profiles.size >= 2) vm::backToChooser else null,
        locked = wait > 0 || checking,
    )
}

/**
 * The PIN of the account in use being set, changed or removed from Settings. Changing and removing ask the current PIN first; a new
 * one is typed twice.
 */
@Composable
fun PinTaskScreen(vm: AppViewModel, task: app.jellyflix.tv.PinTask) {
    val profile = vm.profiles.active ?: return
    // verify -> (remove | new) -> confirm
    var step by remember { mutableStateOf(if (task == app.jellyflix.tv.PinTask.Create) Step.New else Step.Current) }
    var first by remember { mutableStateOf("") }
    var attempt by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var wait by remember { mutableIntStateOf(profile.waitLeftSeconds(System.currentTimeMillis(), android.os.SystemClock.elapsedRealtime())) }
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(wait > 0) {
        while (wait > 0) {
            delay(1_000)
            wait -= 1
        }
    }
    val wrongText = stringResource(R.string.pin_wrong)
    val mismatchText = stringResource(R.string.pin_mismatch)
    Box(Modifier.fillMaxSize().background(Palette.Black)) {
        PinScreen(
            title = stringResource(R.string.pin_title, profile.name),
            subtitle = stringResource(
                when (step) {
                    Step.Current -> R.string.pin_current
                    Step.New -> R.string.pin_new
                    Step.Confirm -> R.string.pin_confirm
                },
            ),
            note = stringResource(R.string.pin_note),
            error = if (wait > 0) stringResource(R.string.pin_wait, wait) else error,
            attempt = attempt,
            locked = wait > 0 || checking,
            onCancel = vm::endPinTask,
            onSubmit = { pin ->
                attempt += 1
                when (step) {
                    Step.Current -> {
                        checking = true
                        scope.launch {
                            try {
                                when (val result = vm.checkPin(profile.id, pin)) {
                                    PinResult.Right -> {
                                        error = null
                                        if (task == app.jellyflix.tv.PinTask.Remove) {
                                            vm.setPin(profile.id, null)
                                            vm.endPinTask()
                                        } else {
                                            step = Step.New
                                        }
                                    }
                                    is PinResult.Wrong -> {
                                        error = wrongText
                                        wait = result.waitSeconds
                                    }
                                    is PinResult.Waiting -> wait = result.seconds
                                }
                            } finally {
                                checking = false
                            }
                        }
                    }
                    Step.New -> {
                        first = pin
                        error = null
                        step = Step.Confirm
                    }
                    Step.Confirm -> if (pin == first) {
                        vm.setPin(profile.id, pin)
                        vm.endPinTask()
                    } else {
                        error = mismatchText
                        step = Step.New
                    }
                }
            },
        )
    }
}

private enum class Step { Current, New, Confirm }

/**
 * A number pad for the remote: the digits typed show as dots, OK sends them (4 to 6 digits). [attempt] changes after every send,
 * which empties the dots. While [locked] (too many wrong tries) the pad does not send.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun PinScreen(
    title: String,
    subtitle: String,
    error: String?,
    attempt: Int,
    onSubmit: (String) -> Unit,
    onCancel: (() -> Unit)?,
    locked: Boolean,
    note: String? = null,
) {
    var digits by remember { mutableStateOf("") }
    val one = remember { FocusRequester() }
    // After every try the dots empty and the remote is back on the 1, ready for the next one.
    LaunchedEffect(attempt) {
        digits = ""
        one.requestFocusSoon()
    }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Spacer(Modifier.height(6.dp))
        Text(subtitle, fontSize = 16.sp, color = Palette.TextDim, textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.height(22.dp)) {
            for (i in 0 until PIN_MAX_DIGITS) {
                val filled = i < digits.length
                Box(
                    Modifier
                        .size(18.dp)
                        .then(if (filled) Modifier.background(Palette.Accent, CircleShape) else Modifier.border(2.dp, Palette.TextDim, CircleShape)),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(error.orEmpty(), fontSize = 15.sp, color = Color(0xFFFF6B6B), textAlign = TextAlign.Center, modifier = Modifier.height(22.dp))
        Spacer(Modifier.height(8.dp))

        val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "OK"))
        val delete = stringResource(R.string.pin_delete)
        val ok = stringResource(R.string.pin_ok)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (row in rows) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (key in row) {
                        PadKey(
                            label = key,
                            description = when (key) {
                                "⌫" -> delete
                                "OK" -> ok
                                else -> key
                            },
                            modifier = if (key == "1") Modifier.focusRequester(one) else Modifier,
                            accent = key == "OK" && digits.length >= PIN_MIN_DIGITS,
                        ) {
                            when (key) {
                                "⌫" -> digits = digits.dropLast(1)
                                "OK" -> if (digits.length >= PIN_MIN_DIGITS && !locked) onSubmit(digits)
                                else -> if (digits.length < PIN_MAX_DIGITS) digits += key
                            }
                        }
                    }
                }
            }
        }
        if (note != null) {
            Spacer(Modifier.height(16.dp))
            Text(note, fontSize = 13.sp, color = Palette.TextDim, textAlign = TextAlign.Center, modifier = Modifier.width(520.dp))
        }
        if (onCancel != null) {
            Spacer(Modifier.height(16.dp))
            Pill(stringResource(R.string.pin_cancel), onClick = onCancel)
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun PadKey(label: String, description: String, modifier: Modifier, accent: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(width = 84.dp, height = 56.dp).semantics { contentDescription = description },
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (accent) Palette.Accent else Palette.Surface3,
            contentColor = if (accent) Palette.AccentInk else Color.White,
            focusedContainerColor = Color.White,
            focusedContentColor = Color.Black,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(label, fontSize = 24.sp, fontWeight = FontWeight.Medium)
        }
    }
}
