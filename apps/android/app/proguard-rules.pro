# Project-specific R8 rules for release builds.
# Libraries in use (Compose, Hilt, Navigation 3, kotlinx.serialization) ship their own rules.

# Guava comes with the libraries and refers to this annotation, which is needed only to compile
# Guava and is not on the run-time classpath. Nothing reads it when the app runs.
-dontwarn com.google.j2objc.annotations.RetainedWith
