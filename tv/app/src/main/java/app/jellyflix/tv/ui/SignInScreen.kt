package app.jellyflix.tv.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.R

/**
 * The first screen. The server address comes first; then either a code approved from a phone (no typing on the remote) or the
 * user's name and password.
 */
@Composable
fun SignInScreen(
    initialServer: String,
    busy: Boolean,
    error: String?,
    quickCode: String?,
    onQuickConnect: (server: String) -> Unit,
    onCancelQuickConnect: () -> Unit,
    onSignIn: (server: String, user: String, password: String) -> Unit,
) {
    var server by remember { mutableStateOf(initialServer) }
    var user by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var withPassword by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val submit = { if (server.isNotBlank() && user.isNotBlank()) onSignIn(server, user, password) }
    val codeButton = remember { FocusRequester() }
    val firstField = remember { FocusRequester() }
    LaunchedEffect(withPassword) { if (withPassword) firstField.requestFocusSoon() }
    LaunchedEffect(quickCode) { if (quickCode == null && !withPassword && initialServer.isNotBlank()) codeButton.requestFocusSoon() }

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.logo), contentDescription = null, modifier = Modifier.size(96.dp))
        Image(painterResource(R.drawable.wordmark), contentDescription = stringResource(R.string.app_name), modifier = Modifier.height(40.dp))
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.signin_tagline), color = Palette.TextDim)
        Spacer(Modifier.height(28.dp))

        val fieldModifier = Modifier.width(480.dp)
        if (quickCode != null) {
            Text(stringResource(R.string.signin_code_title), fontSize = 18.sp, color = Palette.TextDim)
            Spacer(Modifier.height(12.dp))
            Text(
                quickCode.chunked(3).joinToString(" "),
                fontSize = 64.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 6.sp,
                color = Palette.Accent,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.signin_code_steps),
                fontSize = 15.sp,
                color = Palette.TextDim,
                textAlign = TextAlign.Center,
                modifier = Modifier.width(560.dp),
            )
            Spacer(Modifier.height(24.dp))
            Pill(stringResource(R.string.signin_cancel), onClick = onCancelQuickConnect, modifier = Modifier.focusRequester(codeButton))
            LaunchedEffect(Unit) { codeButton.requestFocusSoon() }
        } else {
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { androidx.compose.material3.Text(stringResource(R.string.signin_server)) },
                singleLine = true,
                modifier = fieldModifier.then(if (withPassword) Modifier.focusRequester(firstField) else Modifier),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Down) }),
            )
            Spacer(Modifier.height(16.dp))
            if (!withPassword) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Pill(
                        stringResource(R.string.signin_code),
                        onClick = { onQuickConnect(server) },
                        accent = true,
                        modifier = Modifier.focusRequester(codeButton),
                    )
                    Pill(stringResource(R.string.signin_use_password), onClick = { withPassword = true })
                }
            } else {
                OutlinedTextField(
                    value = user,
                    onValueChange = { user = it },
                    label = { androidx.compose.material3.Text(stringResource(R.string.signin_user)) },
                    singleLine = true,
                    modifier = fieldModifier,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Down) }),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { androidx.compose.material3.Text(stringResource(R.string.signin_password)) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = fieldModifier,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                )
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Pill(
                        stringResource(if (busy) R.string.signin_connecting else R.string.signin_connect),
                        onClick = { if (!busy) submit() },
                        accent = true,
                    )
                    Pill(stringResource(R.string.signin_code), onClick = { withPassword = false; onQuickConnect(server) })
                }
            }
        }
        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error, color = Color(0xFFFF6B6B), textAlign = TextAlign.Center, modifier = Modifier.width(560.dp))
        }
    }
}
