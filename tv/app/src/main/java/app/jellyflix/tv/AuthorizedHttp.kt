package app.jellyflix.tv

import android.net.Uri
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource

/**
 * The data source the players load from. The sign-in token is added only to requests for the Jellyfin server's own host: an address
 * that points somewhere else (a link inside a playlist, say) never gets it. A redirect that the server itself sends is followed (a
 * reverse proxy may send http to https), and Media3 repeats the request's headers when it does.
 */
fun authorizedHttp(serverUrl: String, token: String): DataSource.Factory {
    val serverHost = Uri.parse(serverUrl).host?.lowercase()
    val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
    val header = mapOf("Authorization" to "MediaBrowser Token=\"$token\"")
    return ResolvingDataSource.Factory(http) { spec ->
        if (serverHost != null && spec.uri.host?.lowercase() == serverHost) spec.withAdditionalHeaders(header) else spec
    }
}
