package app.jellyflix.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import app.jellyflix.tv.data.ModulesGate
import app.jellyflix.tv.data.suggestedModulesAddress
import app.jellyflix.tv.data.suggestedWebAddress

/**
 * Settings, Modules: where the optional modules container is, and where the web app is (for the QR code of a Match). With no address the
 * app never looks for the container, and the Modules section is not in the top bar.
 */
@Composable
fun ModulesTab(vm: AppViewModel, first: FocusRequester) {
    val modules = vm.modules
    var address by remember { mutableStateOf(modules.address) }
    var web by remember { mutableStateOf(modules.webAddress) }
    val gate = modules.gate
    val focus = LocalFocusManager.current
    // A text field keeps the arrow keys of a remote for itself once it has been typed in; up and down must still lead out of it.
    val leaveWithArrows = Modifier.onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
        when (event.key) {
            Key.DirectionDown -> focus.moveFocus(FocusDirection.Down)
            Key.DirectionUp -> focus.moveFocus(FocusDirection.Up)
            else -> false
        }
    }
    val suggestedModules = remember(vm.serverUrl) { suggestedModulesAddress(vm.serverUrl) }
    val suggestedWeb = remember(vm.serverUrl) { suggestedWebAddress(vm.serverUrl) }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.modules_set_intro), fontSize = 15.sp, color = Palette.TextDim, modifier = Modifier.width(900.dp))
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            label = { androidx.compose.material3.Text(stringResource(R.string.modules_set_address)) },
            singleLine = true,
            modifier = Modifier.width(720.dp).focusRequester(first).then(leaveWithArrows),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
        )
        if (address.isBlank() && suggestedModules != null) Pill(stringResource(R.string.modules_set_use, suggestedModules), onClick = { address = suggestedModules })
        OutlinedTextField(
            value = web,
            onValueChange = { web = it },
            label = { androidx.compose.material3.Text(stringResource(R.string.modules_set_web)) },
            singleLine = true,
            modifier = Modifier.width(720.dp).then(leaveWithArrows),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
        )
        if (web.isBlank() && suggestedWeb != null) Pill(stringResource(R.string.modules_set_use, suggestedWeb), onClick = { web = suggestedWeb })
        Pill(stringResource(R.string.modules_set_save), onClick = { modules.saveAddresses(address, web) }, accent = true, modifier = Modifier.padding(top = 6.dp))
        val status = when {
            modules.checking -> stringResource(R.string.modules_set_checking) to Palette.TextDim
            gate is ModulesGate.Ready -> stringResource(R.string.modules_set_ready, gate.version) to Palette.TextDim
            gate is ModulesGate.Incompatible -> stringResource(R.string.modules_set_incompatible, gate.version) to Color(0xFFFFB4B4)
            modules.address.isBlank() -> stringResource(R.string.modules_set_none) to Palette.TextDim
            else -> stringResource(R.string.modules_set_absent) to Color(0xFFFFB4B4)
        }
        Text(status.first, fontSize = 15.sp, color = status.second)
    }
}
