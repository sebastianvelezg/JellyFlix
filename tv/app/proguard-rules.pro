# Release builds drop the chatty log lines (verbose, debug and info): they only describe what the app is doing and help nobody on a TV.
# Warnings and errors stay, for a real failure.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
