# Khandani Rishta design tokens: Mehfil Heritage

This is the token sheet for the chosen visual direction, Mehfil Heritage (scheme 3 of the redesign). It lists every colour, type style, radius, border, space and component part, each with its CSS variable and its Jetpack Compose value, so the web app and the Android app can adopt it in one pass.

It is a design reference. Nothing in `apps/` uses these values yet. The launch tokens in `apps/web/src/styles/app.css`, `specs/17-web-app.md` section 9.3, `apps/android/.../ui/theme/Theme.kt` and `specs/22-android-app.md` section 12 stay in force until they are replaced (see the adoption checklist in section 10).

Names follow the code that exists today:

- CSS variables use the Tailwind v4 `@theme` namespaces already in `app.css` (`--color-*`, `--radius-*`, `--font-*`, `--text-*`, `--shadow-*`). Existing names keep their meaning unless section 2.3 says otherwise.
- Compose values use Material 3 roles (`colorScheme`, `typography`, `shapes`) plus the `ExtendedColors` class reached through `KrTheme.colors`.
- Sizes are the same number in both: px on the web, dp or sp on Android.

## 1. Principles

The design is tuned for the hardest reader in the personas: a 58-year-old parent on a mid-range Android phone, often with a larger system font.

| Rule | Value |
|---|---|
| Typeface | Source Sans 3 for every word of the interface. Instrument Serif only for display text, the wordmark, monograms and decorative numerals, at 34 and up except the wordmark (24 to 30) and monogram initials (3.2). |
| Text size | Body 17, long reading 18. Nothing that carries meaning below 15. 14 is the floor, for footer legal text only. |
| Contrast | Text 7:1 or more on its own surface where the palette allows, never below 4.5:1. Control borders and indicators 3:1 or more. |
| Touch | Every target at least 48 x 48, at least 8 apart. Primary actions on phones are 56 tall. |
| Meaning | Never colour alone. Every status pairs colour with an icon and words. |
| Focus | One primary button per screen area. Secondary actions are outlined, tertiary actions are quiet. |
| Direction | Logical properties only (start and end, never left and right), ready for Urdu. |
| Scaling | Layouts survive 200% font scale: rows wrap, names wrap, nothing that matters is cut. |
| Motion | Short and optional. `prefers-reduced-motion` and the Android animator scale are honoured. |
| Craft | Arches, tonal bands, pills, gold hairlines and diamonds. No gradients, no glass, no drop shadows on content. |

## 2. Colour

### 2.1 Roles

Contrast ratios are WCAG 2.x, measured against the surface named in the last column.

| Role | CSS variable | Hex | Compose | Use | Contrast |
|---|---|---|---|---|---|
| Primary | `--color-primary` | `#6E1D34` | `colorScheme.primary` | Primary buttons, links on hover, active navigation, focus ring | 10.3:1 on background |
| Primary hover | `--color-primary-hover` | `#561528` | `Brand.PrimaryPressed` | Hover and pressed state of primary | 12.7:1 on background |
| Primary soft | `--color-primary-soft` | `#F3E4E6` | `colorScheme.primaryContainer`, `secondaryContainer` | Active nav pill, "Must have" tag, "Interested in you" hint, selected template | Primary text 9.0:1 |
| On primary | `--color-primary-foreground` | `#FAF6F0` | `colorScheme.onPrimary` | Text and icons on primary | 10.3:1 on primary |
| Foreground | `--color-foreground` | `#23191D` | `colorScheme.onBackground`, `onSurface` | Headings, values, body text | 15.9:1 on background |
| Secondary text | `--color-foreground-secondary` | `#3D3034` | `KrTheme.colors.textSecondary` | Body copy under headings, the card meta line | 11.7:1 on background |
| Muted text | `--color-muted-foreground` | `#5A4B4F` | `colorScheme.onSurfaceVariant` | Row labels, captions, timestamps, helper text | 7.6:1 on background, 6.9:1 on sand |
| Background | `--color-background` | `#FAF6F0` | `colorScheme.background`, `surface` | Page | |
| Surface | `--color-surface` | `#FFFCF7` | `colorScheme.surfaceContainerLowest`, `KrTheme.colors.card` | Sheets, side panels, menus, text fields | |
| Sand band | `--color-muted` | `#F2EAE0` | `colorScheme.surfaceContainer`, `surfaceVariant` | Tonal bands, reason and hobby chips, quote blocks | |
| Sand strong | `--color-muted-strong` | `#EADFD2` | `colorScheme.surfaceContainerHigh`, `KrTheme.colors.disabledContainer` | Disabled buttons ("Interest sent"), hover on sand | Secondary text 9.6:1 |
| Border | `--color-border` | `#E3D7C6` | `colorScheme.outlineVariant` | Hairline dividers and menu outlines. Decoration only, never the outline of a control. | |
| Control border | `--color-input` | `#8F7E77` | `colorScheme.outline` | Secondary and quiet buttons, fields, checkboxes, switch track off | 3.6:1 on background |
| Focus ring | `--color-ring` | `#6E1D34` | `KrTheme.colors.focusRing` | 3 px outline, 3 px offset | 10.3:1 on background |
| Success, match | `--color-success` | `#2D6350` | `KrTheme.colors.success`, `KrTheme.colors.match` | Match pill, verified badges, ticks, "Interest sent", online dot | White text 7.0:1, 6.5:1 on background |
| Success soft | `--color-success-soft` | `#E3EDE6` | `KrTheme.colors.successContainer` | Badge fill, verification panel, "You match" summary | Success text 5.8:1 |
| Gold indicator | `--color-accent` | `#9C7430` | `colorScheme.tertiary` | Attention diamond on "Me", small indicators | 3.9:1 on background |
| Gold soft | `--color-accent-soft` | `#F6ECD9` | `colorScheme.tertiaryContainer` | Rare highlight fills | `#5C4211` text 8.0:1 |
| Gold ornament | `--color-accent-decor` | `#B68B40` | `KrTheme.colors.ornament` | Hairline rules, diamonds, arch outlines, link underlines. Never text, never the only signal. | |
| Gold on inverse | `--color-accent-on-inverse` | `#C9A25E` | `colorScheme.inversePrimary` | Numerals and labels on the dark band, toast actions | 7.2:1 on inverse |
| Attention | `--color-warning` | `#8A5300` | `KrTheme.colors.warning` | Interest expiring within 3 days, "under review" | 5.7:1 on warning soft |
| Attention soft | `--color-warning-soft` | `#FDF1DC` | `KrTheme.colors.warningContainer` | Fill behind attention notes | |
| Danger | `--color-danger` | `#A4262C` | `colorScheme.error` | Errors, Block and Delete confirmations | White text 7.3:1, 6.7:1 on background |
| Danger hover | `--color-danger-hover` | `#861C22` | `Brand.DangerPressed` | Hover and pressed state of danger | |
| Danger soft | `--color-danger-soft` | `#FBE9E7` | `colorScheme.errorContainer` | Error banners and field error fills | Danger text 6.2:1 |
| On danger | `--color-danger-foreground` | `#FFFFFF` | `colorScheme.onError` | Text on danger | 7.3:1 |
| Inverse | `--color-inverse` | `#23191D` | `colorScheme.inverseSurface` | Dark landing band, footer, toasts, count badges | |
| On inverse | `--color-inverse-foreground` | `#F2EAE0` | `colorScheme.inverseOnSurface` | Text on inverse | 14.3:1 |
| Inverse muted | `--color-inverse-muted` | `#CDBFB8` | `KrTheme.colors.inverseMuted` | Secondary text on inverse | 9.6:1 |

Fixed translucent values (not themeable):

| Use | CSS | Compose |
|---|---|---|
| Veil over a blurred photo | `rgb(242 234 224 / 0.55)` | `Color(0x8CF2EAE0)` |
| Photo count chip | `rgb(35 25 29 / 0.82)` | `Color(0xD123191D)` |
| No-photo lattice dots | `rgb(182 139 64 / 0.24)`, 1.4 px dots on an 18 px grid, over `--color-muted` | `Color(0x3DB68B40)` drawn in `drawBehind` |
| Verification panel rule | `rgb(45 99 80 / 0.3)` | `Color(0x4D2D6350)` |

### 2.2 Pairings to avoid

- Gold ornament (`#B68B40`) as text or as the only way to read a state: 2.9:1 on background.
- Primary on sand strong for small text (below 17): use foreground instead.
- Danger and primary side by side: they are both red-leaning. Danger appears only in confirmations and errors, always with an icon or a verb.

### 2.3 Changes against today's tokens

| Name | Today | Mehfil Heritage | Note |
|---|---|---|---|
| `--color-primary` | `#0F766E` teal | `#6E1D34` pomegranate | |
| `--color-primary-foreground` | `#FFFFFF` | `#FAF6F0` | |
| `--color-accent` | `#B45309`, used for the match badge | `#9C7430`, indicators only | The match badge moves to `--color-success`. Components that used `accent` for the match badge must switch. |
| `--color-accent-foreground` | `#FFFFFF` | `#FFFFFF` | Icons only on gold; gold fills never carry body text. |
| `--color-muted` | `#F5F5F4` | `#F2EAE0` | Becomes the tonal band colour. |
| `--color-muted-foreground` | `#57534E` | `#5A4B4F` | |
| `--color-input` | `#78716C` | `#8F7E77` | Still 3:1 or more. |
| `--radius-card` | `12px` | `24px` | |
| `--radius-input` | `8px` | `16px` | |
| `--font-sans` | Inter | Source Sans 3 | |
| `heroGradient`, `compatGradient`, `photoScrim` | Gradients in `ExtendedColors` | Removed | Flat fills only. Text never sits on a photo, so no scrim is needed. |

### 2.4 CSS

```css
@theme {
  --color-primary: #6e1d34;
  --color-primary-hover: #561528;
  --color-primary-soft: #f3e4e6;
  --color-primary-foreground: #faf6f0;

  --color-accent: #9c7430;
  --color-accent-soft: #f6ecd9;
  --color-accent-foreground: #ffffff;
  --color-accent-decor: #b68b40;
  --color-accent-on-inverse: #c9a25e;

  --color-success: #2d6350;
  --color-success-soft: #e3ede6;
  --color-success-foreground: #ffffff;
  --color-warning: #8a5300;
  --color-warning-soft: #fdf1dc;
  --color-danger: #a4262c;
  --color-danger-hover: #861c22;
  --color-danger-soft: #fbe9e7;
  --color-danger-foreground: #ffffff;

  --color-background: #faf6f0;
  --color-surface: #fffcf7;
  --color-muted: #f2eae0;
  --color-muted-strong: #eadfd2;
  --color-foreground: #23191d;
  --color-foreground-secondary: #3d3034;
  --color-muted-foreground: #5a4b4f;
  --color-border: #e3d7c6;
  /* Control borders need 3:1 against the background (WCAG 1.4.11). */
  --color-input: #8f7e77;
  --color-ring: #6e1d34;

  --color-inverse: #23191d;
  --color-inverse-foreground: #f2eae0;
  --color-inverse-muted: #cdbfb8;
}
```

### 2.5 Compose

```kotlin
object Brand {
    val Primary = Color(0xFF6E1D34)
    val PrimaryPressed = Color(0xFF561528)
    val PrimarySoft = Color(0xFFF3E4E6)
    val OnPrimary = Color(0xFFFAF6F0)
    val Gold = Color(0xFF9C7430)
    val GoldSoft = Color(0xFFF6ECD9)
    val GoldOrnament = Color(0xFFB68B40)
    val GoldOnInverse = Color(0xFFC9A25E)
    val Sage = Color(0xFF2D6350)
    val SageSoft = Color(0xFFE3EDE6)
    val Warning = Color(0xFF8A5300)
    val WarningSoft = Color(0xFFFDF1DC)
    val Danger = Color(0xFFA4262C)
    val DangerPressed = Color(0xFF861C22)
    val DangerSoft = Color(0xFFFBE9E7)
    val Background = Color(0xFFFAF6F0)
    val Surface = Color(0xFFFFFCF7)
    val Sand = Color(0xFFF2EAE0)
    val SandStrong = Color(0xFFEADFD2)
    val Ink = Color(0xFF23191D)
    val InkSecondary = Color(0xFF3D3034)
    val InkMuted = Color(0xFF5A4B4F)
    val Border = Color(0xFFE3D7C6)
    val Outline = Color(0xFF8F7E77)
    val InverseMuted = Color(0xFFCDBFB8)
}

private val LightColors =
    lightColorScheme(
        primary = Brand.Primary,
        onPrimary = Brand.OnPrimary,
        primaryContainer = Brand.PrimarySoft,
        onPrimaryContainer = Brand.Primary,
        inversePrimary = Brand.GoldOnInverse,
        secondary = Brand.InkSecondary,
        onSecondary = Brand.Background,
        // NavigationBar and tonal buttons read secondaryContainer: keep it the primary soft pill.
        secondaryContainer = Brand.PrimarySoft,
        onSecondaryContainer = Brand.Primary,
        tertiary = Brand.Gold,
        onTertiary = Color.White,
        tertiaryContainer = Brand.GoldSoft,
        onTertiaryContainer = Color(0xFF5C4211),
        error = Brand.Danger,
        onError = Color.White,
        errorContainer = Brand.DangerSoft,
        onErrorContainer = Color(0xFF6E1418),
        background = Brand.Background,
        onBackground = Brand.Ink,
        surface = Brand.Background,
        onSurface = Brand.Ink,
        surfaceVariant = Brand.Sand,
        onSurfaceVariant = Brand.InkMuted,
        surfaceTint = Color.Transparent,
        inverseSurface = Brand.Ink,
        inverseOnSurface = Brand.Sand,
        outline = Brand.Outline,
        outlineVariant = Brand.Border,
        scrim = Color.Black,
        surfaceBright = Brand.Surface,
        surfaceDim = Brand.SandStrong,
        surfaceContainerLowest = Brand.Surface,
        surfaceContainerLow = Color(0xFFF7F1E9),
        surfaceContainer = Brand.Sand,
        surfaceContainerHigh = Brand.SandStrong,
        surfaceContainerHighest = Brand.Border,
    )

/** Colours that Material 3 has no slot for. */
@Immutable
data class ExtendedColors(
    val textSecondary: Color = Brand.InkSecondary,
    val success: Color = Brand.Sage,
    val onSuccess: Color = Color.White,
    val successContainer: Color = Brand.SageSoft,
    val onSuccessContainer: Color = Brand.Sage,
    val match: Color = Brand.Sage,
    val online: Color = Brand.Sage,
    val warning: Color = Brand.Warning,
    val warningContainer: Color = Brand.WarningSoft,
    val card: Color = Brand.Surface,
    val band: Color = Brand.Sand,
    val ornament: Color = Brand.GoldOrnament,
    val inverseMuted: Color = Brand.InverseMuted,
    val disabledContainer: Color = Brand.SandStrong,
    val onDisabledContainer: Color = Brand.InkSecondary,
    val focusRing: Color = Brand.Primary,
    val photoVeil: Color = Color(0x8CF2EAE0),
    val photoCountChip: Color = Color(0xD123191D),
    val lattice: Color = Color(0x3DB68B40),
    val skeleton: Color = Brand.SandStrong,
    val skeletonHighlight: Color = Brand.Surface,
)
```

Dynamic colour stays off and the app stays light only, as `specs/22-android-app.md` section 12 already says.

## 3. Typography

### 3.1 Families

| Family | Weights | CSS | Compose | Where |
|---|---|---|---|---|
| Source Sans 3 | 400, 600, 700 (italic 400 for quotes if needed) | `--font-sans: "Source Sans 3 Variable", "Source Sans 3", "Noto Sans", ui-sans-serif, sans-serif` | `SourceSans` | All interface text, headings, names, numbers |
| Instrument Serif | 400 regular and italic | `--font-display: "Instrument Serif", Georgia, serif` | `InstrumentSerif` | Wordmark, landing display headings, monograms (italic), decorative numerals |
| Noto Nastaliq Urdu | 400, 700 | `--font-urdu: "Noto Nastaliq Urdu", serif` | `NotoNastaliq` | Urdu locale, later phase. Needs line height 1.9 or more. |

Both Latin families are under the SIL Open Font License. On the web, self-host them the way Inter is today (`@fontsource-variable/source-sans-3` and `@fontsource/instrument-serif`). On Android, bundle the files in `res/font`: the APK ships outside the Play Store, so do not rely on downloadable fonts from Google Play services.

### 3.2 Scale

Sizes are px on the web and sp on Android. Line heights are absolute. Letter spacing is 0 for every role except the display roles (-0.01em).

| Role | Family | Weight | Size / line | CSS variable | Use |
|---|---|---|---|---|---|
| displayLarge | Serif | 400 | 48 / 52 (web landing hero: fluid 46 to 112) | `--text-display-lg` | Landing hero, onboarding welcome |
| displayMedium | Serif | 400 | 40 / 46 (web landing sections: fluid 36 to 64) | `--text-display-md` | Landing section titles |
| displaySmall | Serif | 400 | 34 / 40 | `--text-display-sm` | Closing bands. The smallest serif size. |
| headlineLarge | Sans | 700 | 32 / 38 (wide screens may grow to 40 / 46) | `--text-headline-lg` | Profile name |
| headlineMedium | Sans | 700 | 28 / 34 | `--text-headline-md` | Screen titles, the Home greeting |
| headlineSmall | Sans | 700 | 24 / 30 | `--text-headline-sm` | Section titles in the app ("Your matches", "Basics") |
| titleLarge | Sans | 700 | 22 / 28 | `--text-title-lg` | Card names, dialog titles, empty state titles |
| titleMedium | Sans | 600 | 19 / 26 | `--text-title-md` | Interest banner title, list names, FAQ questions, phone top bar name |
| titleSmall | Sans | 600 | 17 / 24 | `--text-title-sm` | Row values, nudge titles |
| bodyLarge | Sans | 400 | 18 / 30 | `--text-body-lg` | About text, family notes, partner notes. Max 64 characters a line. |
| bodyMedium | Sans | 400 | 17 / 26 | `--text-body-md` | Default interface text, the card meta line |
| bodySmall | Sans | 400 | 16 / 24 | `--text-body-sm` | Row labels, secondary text, reasons |
| labelLarge | Sans | 600 | 17 / 22 (700 at 18 / 24 on 56 tall buttons) | `--text-label-lg` | Buttons |
| labelMedium | Sans | 600 | 16 / 20 | `--text-label-md` | Chips, menu items, desktop navigation |
| labelSmall | Sans | 600 | 15 / 20 (700 for badges and tags) | `--text-label-sm` | Badges, tags, tab bar labels, count chips |
| caption | Sans | 400 | 15 / 22 | `--text-caption` | Timestamps, helper text under fields, limits ("4 of 5 interests left today") |
| legal | Sans | 400 | 14 / 20 | `--text-legal` | Footer legal line only |

Rules:

1. Serif never goes below 34 except the wordmark (24 to 30) and monogram initials, which are images of letters rather than reading text.
2. Numbers that people compare (ages, percentages, counts, heights) use tabular figures: `font-variant-numeric: tabular-nums` on the web, `fontFeatureSettings = "tnum"` in Compose.
3. No all-caps labels and no letter-spaced small text. Footer group labels are sentence case at 16 / 700.
4. Long reading text keeps a measure of 64 characters (`max-width: 64ch`).
5. Text never sits on a photo. Photo states use a veil with their own text pill.

### 3.3 CSS

```css
@theme {
  --font-sans: "Source Sans 3 Variable", "Source Sans 3", "Noto Sans", ui-sans-serif, sans-serif;
  --font-display: "Instrument Serif", Georgia, serif;
  --font-urdu: "Noto Nastaliq Urdu", serif;

  --text-display-lg: clamp(2.875rem, 7.6vw, 7rem);
  --text-display-lg--line-height: 1.02;
  --text-display-md: clamp(2.25rem, 4.4vw, 4rem);
  --text-display-md--line-height: 1.05;
  --text-display-sm: 2.125rem;
  --text-display-sm--line-height: 2.5rem;

  --text-headline-lg: 2rem;
  --text-headline-lg--line-height: 2.375rem;
  --text-headline-lg--font-weight: 700;
  --text-headline-md: 1.75rem;
  --text-headline-md--line-height: 2.125rem;
  --text-headline-md--font-weight: 700;
  --text-headline-sm: 1.5rem;
  --text-headline-sm--line-height: 1.875rem;
  --text-headline-sm--font-weight: 700;

  --text-title-lg: 1.375rem;
  --text-title-lg--line-height: 1.75rem;
  --text-title-lg--font-weight: 700;
  --text-title-md: 1.1875rem;
  --text-title-md--line-height: 1.625rem;
  --text-title-md--font-weight: 600;
  --text-title-sm: 1.0625rem;
  --text-title-sm--line-height: 1.5rem;
  --text-title-sm--font-weight: 600;

  --text-body-lg: 1.125rem;
  --text-body-lg--line-height: 1.875rem;
  --text-body-md: 1.0625rem;
  --text-body-md--line-height: 1.625rem;
  --text-body-sm: 1rem;
  --text-body-sm--line-height: 1.5rem;

  --text-label-lg: 1.0625rem;
  --text-label-lg--line-height: 1.375rem;
  --text-label-lg--font-weight: 600;
  --text-label-md: 1rem;
  --text-label-md--line-height: 1.25rem;
  --text-label-md--font-weight: 600;
  --text-label-sm: 0.9375rem;
  --text-label-sm--line-height: 1.25rem;
  --text-label-sm--font-weight: 600;

  --text-caption: 0.9375rem;
  --text-caption--line-height: 1.375rem;
  --text-legal: 0.875rem;
  --text-legal--line-height: 1.25rem;
}
```

The `html` base size changes from 16 to 17 (`font-size: 17px` on `body` in `@layer base`), and `line-height` from 1.5 to 26 px.

### 3.4 Compose

```kotlin
val SourceSans =
    FontFamily(
        Font(R.font.source_sans_3_regular, FontWeight.Normal),
        Font(R.font.source_sans_3_semibold, FontWeight.SemiBold),
        Font(R.font.source_sans_3_bold, FontWeight.Bold),
    )

val InstrumentSerif =
    FontFamily(
        Font(R.font.instrument_serif_regular, FontWeight.Normal),
        Font(R.font.instrument_serif_italic, FontWeight.Normal, FontStyle.Italic),
    )

private fun style(family: FontFamily, weight: FontWeight, size: Int, line: Int, tracking: Float = 0f) =
    TextStyle(
        fontFamily = family,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = line.sp,
        letterSpacing = tracking.em,
        platformStyle = PlatformTextStyle(includeFontPadding = false),
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    )

private val AppTypography =
    Typography(
        displayLarge = style(InstrumentSerif, FontWeight.Normal, 48, 52, -0.01f),
        displayMedium = style(InstrumentSerif, FontWeight.Normal, 40, 46, -0.01f),
        displaySmall = style(InstrumentSerif, FontWeight.Normal, 34, 40, -0.01f),
        headlineLarge = style(SourceSans, FontWeight.Bold, 32, 38),
        headlineMedium = style(SourceSans, FontWeight.Bold, 28, 34),
        headlineSmall = style(SourceSans, FontWeight.Bold, 24, 30),
        titleLarge = style(SourceSans, FontWeight.Bold, 22, 28),
        titleMedium = style(SourceSans, FontWeight.SemiBold, 19, 26),
        titleSmall = style(SourceSans, FontWeight.SemiBold, 17, 24),
        bodyLarge = style(SourceSans, FontWeight.Normal, 18, 30),
        bodyMedium = style(SourceSans, FontWeight.Normal, 17, 26),
        bodySmall = style(SourceSans, FontWeight.Normal, 16, 24),
        labelLarge = style(SourceSans, FontWeight.SemiBold, 17, 22),
        labelMedium = style(SourceSans, FontWeight.SemiBold, 16, 20),
        labelSmall = style(SourceSans, FontWeight.SemiBold, 15, 20),
    )

/** Roles Material 3 has no slot for. */
object KrType {
    val caption = style(SourceSans, FontWeight.Normal, 15, 22)
    val legal = style(SourceSans, FontWeight.Normal, 14, 20)
    val buttonLarge = style(SourceSans, FontWeight.Bold, 18, 24)
    val badge = style(SourceSans, FontWeight.Bold, 15, 20)
    val monogram = TextStyle(fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic)
    val numbers = TextStyle(fontFeatureSettings = "tnum")
}
```

## 4. Shape

### 4.1 Radii

| Token | CSS | Compose | Use |
|---|---|---|---|
| sm | `--radius-sm: 10px` | `shapes.small` (10 dp) | Small fills, code chips |
| md | `--radius-md: 16px` | `shapes.medium` (16 dp) | Text fields, text areas, the bottom corners of arches |
| lg | `--radius-lg: 24px` | `shapes.large` (24 dp) | Cards, panels, nudges, menus, the end-of-matches card |
| xl | `--radius-xl: 28px` | `shapes.extraLarge` (28 dp) | Interest callout, empty state panel, dialogs |
| sheet | `24px 24px 0 0` | `RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)` | Phone action bar and bottom sheets |
| pill | `--radius-pill: 999px` | `PillShape` | Buttons, chips, badges, tags, nav pills, switch tracks |
| row | `20px` | `RoundedCornerShape(20.dp)` | Multi-line rows (privacy switches, hero facts on phones). Pills never hold two lines. |
| arch | `50% 50% 16px 16px / 40% 40% 16px 16px` | `ArchShape` | Every member photo and monogram, at 4:5 |

Kept aliases: `--radius-card: var(--radius-lg)` and `--radius-input: var(--radius-md)`.

The arch is a half circle on top of a rectangle. At the 4:5 ratio the CSS above draws exactly that (40% of the height equals 50% of the width). For a square badge use `50% 50% 12px 12px`.

```kotlin
private val AppShapes =
    Shapes(
        extraSmall = RoundedCornerShape(8.dp),
        small = RoundedCornerShape(10.dp),
        medium = RoundedCornerShape(16.dp),
        large = RoundedCornerShape(24.dp),
        extraLarge = RoundedCornerShape(28.dp),
    )

val PillShape = RoundedCornerShape(percent = 50)

/** Half circle on top (50% of the width), [base] corners at the bottom. Use on 4:5 boxes. */
fun archShape(base: Dp = 16.dp) =
    RoundedCornerShape(
        topStart = CornerSize(50),
        topEnd = CornerSize(50),
        bottomEnd = CornerSize(base),
        bottomStart = CornerSize(base),
    )

val ArchShape = archShape()
```

Material components keep their default shape slots except where this table says otherwise: buttons, chips and `NavigationBar` indicators take `PillShape`, cards take `shapes.large`, text fields take `shapes.medium`.

### 4.2 Borders

| Token | CSS | Compose | Use |
|---|---|---|---|
| Hairline | `1px solid var(--color-border)` | `BorderStroke(1.dp, colorScheme.outlineVariant)` | Row rules, section dividers, menus |
| Control | `1.5px solid var(--color-input)` | `BorderStroke(1.5.dp, colorScheme.outline)` | Secondary buttons, fields, checkboxes; quiet buttons and the locked value pill at 1 px |
| Selected | `1.5px solid var(--color-primary)` | `BorderStroke(1.5.dp, colorScheme.primary)` | Chosen template chip, checked checkbox |
| Focus | `outline: 3px solid var(--color-ring); outline-offset: 3px` | 3 dp `KrTheme.colors.focusRing` ring drawn by a focus `Indication` | Every interactive element, keyboard and D-pad. On a primary band the ring takes `--color-primary-foreground` (10.3:1). |
| Ornament | `1px solid var(--color-accent-decor)` | `BorderStroke(1.dp, KrTheme.colors.ornament)` | Inner arch lines, monogram arches |
| Empty | `1.5px dashed var(--color-accent-decor)` | `Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))` | Empty and end-of-list arches |
| Quote | `border-inline-start: 3px solid var(--color-accent-decor)` | A 3 dp start bar | Interest messages, quotes |

## 5. Space, size and layout

### 5.1 Spacing scale

The scale is Tailwind's default 4 px step (`--spacing: 0.25rem`), so `p-4` is 16 px. Use only these steps:

| Step | px or dp | Tailwind | Compose | Typical use |
|---|---|---|---|---|
| 1 | 4 | `1` | `Spacing.s4` | Icon to text inside a badge |
| 2 | 8 | `2` | `Spacing.s8` | Between chips, badges and small targets (the minimum gap between targets) |
| 3 | 12 | `3` | `Spacing.s12` | Between buttons in a row, icon to text in rows |
| 4 | 16 | `4` | `Spacing.s16` | Inside panels on phones, between card blocks |
| 5 | 20 | `5` | `Spacing.s20` | Phone screen gutters, panel padding |
| 6 | 24 | `6` | `Spacing.s24` | Card padding on wide screens, section heading to content |
| 8 | 32 | `8` | `Spacing.s32` | Between a section's groups |
| 10 | 40 | `10` | `Spacing.s40` | Between columns, card gap on wide screens |
| 12 | 48 | `12` | `Spacing.s48` | Rail gap |
| 14 | 56 | `14` | `Spacing.s56` | Wide gutters, band padding |
| 16 | 64 | `16` | `Spacing.s64` | Band padding on wide screens |
| 20 | 80 | `20` | `Spacing.s80` | Landing section padding |

```kotlin
object Spacing {
    val s4 = 4.dp
    val s8 = 8.dp
    val s12 = 12.dp
    val s16 = 16.dp
    val s20 = 20.dp
    val s24 = 24.dp
    val s32 = 32.dp
    val s40 = 40.dp
    val s48 = 48.dp
    val s56 = 56.dp
    val s64 = 64.dp
    val s80 = 80.dp
}
```

### 5.2 Sizes

| Token | Value | CSS | Compose |
|---|---|---|---|
| Touch target | 48 | `--size-touch: 48px` | `Sizes.touch` (also `minimumInteractiveComponentSize()`) |
| Large touch target | 56 | `--size-touch-lg: 56px` | `Sizes.touchLarge` |
| Icon | 24 (navigation), 20 (rows, buttons), 16 (ticks in lists) | | `Sizes.icon`, `Sizes.iconSmall`, `Sizes.iconTiny` |
| Arch avatar | 40 x 50, 46 x 58, 56 x 70, 64 x 80, 96 x 120 | | `Sizes.arch40` and so on |
| Card width | 272 to 340, 30% of the container; 272 when the window is 820 tall or less | `clamp(272px, 30cqi, 340px)` | `Modifier.widthIn(272.dp, 340.dp)` |
| Phone top bar | 64 | | `Sizes.topBar` |
| Wide top bar | 80 | | |
| Bottom navigation | 64 plus the system inset | | `NavigationBar` with `Modifier.height(64.dp)` |
| Content column | up to 1,168 (1,280 with gutters) | `--container-content: 73rem` | |
| Side rail | 320 to 380 | | |
| Gutters | 20 on phones, up to 56 on wide screens | `clamp(20px, 4vw, 56px)` | 20 dp |
| Breakpoint | 768 | `--breakpoint-wide: 768px` | `WindowWidthSizeClass.Medium` and up |

### 5.3 Elevation

Content is flat: separation comes from tonal bands and hairlines. Only floating layers cast a shadow.

| Layer | CSS | Compose |
|---|---|---|
| Menus and popovers | `--shadow-menu: 0 24px 48px -24px rgb(35 25 29 / 0.45)` | `shadowElevation = 3.dp` |
| Side rail panel | `--shadow-panel: 0 30px 60px -40px rgb(35 25 29 / 0.55)` | `shadowElevation = 2.dp` |
| Phone action bar and sheets | `--shadow-bar: 0 -18px 36px -26px rgb(35 25 29 / 0.55)` | `shadowElevation = 6.dp` |
| Everything else | none | `tonalElevation = 0.dp` |

### 5.4 Motion

| Token | CSS | Compose | Use |
|---|---|---|---|
| Fast | `--duration-fast: 150ms` | `tween(150)` | Switch thumb, press states |
| Base | `--duration-base: 200ms` | `tween(200)` | Chevrons, expanding details, sheets |
| Easing | `--ease-standard: cubic-bezier(0.2, 0, 0, 1)` | `FastOutSlowInEasing` | All of the above |

Reduced motion keeps the existing rule in `app.css`, and Compose checks the animator duration scale.

## 6. Components

Component names match `specs/17-web-app.md` section 10 where one exists.

### 6.1 Button

| Variant | Fill | Border | Text | Use |
|---|---|---|---|---|
| Primary | primary | primary | on primary | The one main action of an area: "Send interest", "Accept", "Review preferences" |
| Secondary | none | control 1.5 | foreground | "Decline", "Shortlist", "Withdraw" |
| Quiet | none | control 1 | foreground | "More", "Not interested", "Report" |
| Inverse | background | background | primary | The main action on a primary band ("View" on the interest callout) |
| Ink | foreground | foreground | background | Confirming a negative choice that is not destructive ("Decline" in the decline dialog) |
| Danger | danger | danger | on danger | Confirming a destructive choice ("Block", "Delete account") |
| Disabled | sand strong | sand strong | secondary text | A state the person should still read ("Interest sent"). Never 38% grey text. |

Anatomy: pill shape, optional 20 icon at the start, 10 between icon and label, label `labelLarge`. Default height 48 with 22 side padding; large height 56 with 28 side padding and 18 / 700 label. If a label does not fit, the button goes full width, and only then may the label wrap. Hover: primary darkens to primary hover, others fill with sand. Compose: `Button`, `OutlinedButton`, `TextButton` with `PillShape`, `contentPadding = PaddingValues(horizontal = 22.dp)`, `Modifier.heightIn(min = 48.dp)`.

### 6.2 Text link

17 / 600, foreground, 2 px gold ornament underline 6 px below the baseline, 48 tall hit area. Hover turns the text primary. Used for "See all", "Read the safety tips".

### 6.3 Badge (`BadgeRow`)

Pill, success soft fill, success text, `labelSmall` bold, 14 tick icon, 6 gap, 5 by 12 padding. One badge per earned check in the order ID, photo, phone. Words are always shown ("ID verified"), not icons alone. Wraps onto a new line with 8 gaps.

### 6.4 Tag

"Must have": pill, primary soft fill, primary text, 15 / 700, 3 by 10 padding. Sits after the dimension label.

### 6.5 Match pill (`CompatBadge`)

Pill, success fill, white. Number 20 / 700 tabular, then "match" 16 / 600, baseline aligned, 6 gap, 6 by 14 padding. Compact size: 17 and 15, 4 by 12 padding. On the profile the same number sits in a 160 ring (11 stroke, success on success soft) with the number at 42 / 700.

### 6.6 Reasons (`ReasonChips`)

Up to three reasons as a list, not as pills, because the spec labels are long ("Religious practice matches your preference"). Each line: a 6 muted dot centred in a 16 column on the first line, 8 gap, `bodySmall` text, wraps freely. Never a tick: on cards and in reasons a tick means verified. List label for screen readers: "Why this match".

### 6.7 Relation hint

| Relation | Look |
|---|---|
| Interest sent | Secondary text 16 / 700 with an 18 envelope, the icon of Interests |
| Interested in you | Primary soft pill, primary text 16 / 700, the same 18 envelope. The heart belongs to Shortlist alone. |
| Connected | Success soft pill, success text, two-people icon |

### 6.8 Member photo (`MemberPhoto`)

Always an arch at 4:5.

| State | Layers |
|---|---|
| Clear | Photo, `object-fit: cover`. |
| Private | Photo blurred 12 (22 on the profile), veil, inner gold arch line inset 14, 9 gold diamond, monogram in serif italic (58 on cards, 76 on the profile), then a background pill "Photos private" with a lock. |
| None | Sand with the gold lattice, the same inner arch, diamond and monogram, then a pill "No photo added yet" with a camera icon. No request button, no gallery controls. |
| Count | Dark chip at the bottom end: "4 photos" (`labelSmall`), only when there are 2 or more. |
| New | Primary chip at the bottom start: "New" 15 / 700. This is where the `new` badge shows; it is not part of the badge row. |

The veil keeps room at its bottom for the Count and New chips (16 plus 2.2 em), so they never cover its pill at larger text.

The monogram is the first letters of the first and last words of the display name ("Muhammad Abdul Rehman S." gives "MS"). Content descriptions: "Photo of {name}" or "Private photo" (`specs/22` section 12).

### 6.9 Profile card (`ProfileCard`, full size)

A card helps a family decide whether to open a profile; the profile explains. It carries only the elements of `specs/16` section 1.5 (education, height, religion or sect, caste and activity are on the profile, not the card).

Width 272 to 340, no card chrome and no hairlines: the card sits on the band and is held together by alignment and spacing. Top to bottom:

1. Member photo, full width (6.8).
2. Head, 12 below: name and age (`titleLarge`, wraps to as many lines as needed, never cut), the match pill (6.5) and the relation hint (6.7) on one wrapping line, 8 apart; the verification badges (6.3) 8 below, by the name.
3. Reasons (6.6), 12 below.
4. Who, 16 below: one meta line "{location} · {work}", adding " · {marital status}" when it is not "Never married" (`bodyMedium`, secondary colour, wraps between items, never starts with a dot); "Profile managed by {label}" (`bodySmall`, secondary colour, 600) 4 below when not self.
5. Actions, at least 16 below and pinned to the bottom: Shortlist (secondary, grows, a pressed toggle that reads "Shortlisted") and More (quiet), 48 tall, 12 apart. When they do not fit side by side (large text), each goes full width on its own line. More opens a menu with "Not interested".

The whole card opens the profile: the name link stretches over the card, under Shortlist and More, so each card is one link and one tab stop before its buttons. On wide web (768 and up) the parts line up across a row (CSS subgrid), so names, reasons, the meta line and actions start at the same height on every card. On phones each card keeps its own height, so one long name does not lengthen the others.

Height budget: at 272 wide and the default text size, a card with a one-line name and meta line and three one-line reasons is about 650 tall, inside the 702 that a 390 x 844 phone shows between its top bar and bottom navigation. When a card grows past that, cut content before shrinking text or the photo (`PRODUCT.md` principle 5).

"Not interested" replaces the card in place with a sand panel of the card's full height: "{name} is hidden from your matches." (`titleMedium`), "You will not see this profile for 6 months." (`bodySmall`, muted) and Undo (secondary). It stays until the member leaves the screen.

Compact size (interests, shortlist, visitors, requests, "Near you" on Home): a row with a 60 x 76 arch, then name and age at 19 / 700 with the compact match pill and any relation hint on the same wrapping line, one line of "{city} · {work}", and the badges. The whole row is the link, at least 76 tall.

Tile ("New members" on Home only): 156 wide, a 156 x 195 arch with the New chip, name and age at 18 / 700, the compact match pill, then location and work on two lines at 16. The whole tile is the link.

### 6.10 Info row and locked value (`LockedValue`, `SectionCard`)

A definition row: label (`bodySmall`, muted, flexible basis 140) and value (`titleSmall`, flexible basis 170, grows 1.4 times as fast), 16 apart, 12 vertical padding, hairline below. When the column is too narrow the value drops under the label. Values in a group start on the same line, so the eye can run down them.

A locked value replaces the value with an outlined pill (1 px control border, 15 / 600, lock icon): "Visible after you connect".

Section headings use `headlineSmall` after an 8 gold diamond. Groups sit in alternating background and sand bands; two groups share a band side by side on wide screens.

### 6.11 Switch row

The whole row is the switch (`role="switch"`, `Modifier.toggleable`), at least 72 tall, `row` radius, sand fill. Label 18 / 700 and help text 16 / 400 muted on the start side; on the end a 56 x 32 track (primary when on, control border colour when off) with a 26 thumb, then the word "On" or "Off".

### 6.12 Interest banner (`StatusBanner`, `interest_from_owner`)

Sits directly on top of the action bar, as one unit (`specs/16` section 6.7, action bar row 2).

1. Monogram arch (40 x 50 on phones, 46 x 58 wide) and the title "{name} is interested in you" (`titleMedium` bold, wraps).
2. Expiry: 16 clock and "Expires {date}" in `caption`, muted. In the last 3 days it switches to attention colour on attention soft, keeping the icon.
3. The message, when set: sand quote block with the 3 gold start bar, 16 on phones and 17 wide, up to 300 characters, shown in full.
4. Actions: Decline (secondary) and Accept (primary, 1.4 times as wide on phones; full width and stacked on wide panels), 56 tall, 12 apart. Shortlist and More (Let {name} see my photos, Report, Block) follow on wide screens and sit in the phone top bar.

### 6.13 Decline dialog (`ConfirmDialog`)

A bottom sheet on phones and the side panel on wide screens. Title "Decline this interest?" (`titleLarge`), body "{name} will not be notified." (`bodyMedium`), a 48 tall checkbox row "Also block {name}" (26 box, 7 radius, control border, primary when checked), then Cancel (secondary) and Decline (ink), 56 tall, equal width.

### 6.14 Action bar (phone)

Sticky to the bottom, surface fill, sheet radius, hairline top, bar shadow, 14 to 16 padding. It holds one primary button at full width (56) and at most one line of `caption` under it ("4 of 5 interests left today"). Secondary actions go to the top bar so the primary stays large.

### 6.15 Empty state and end of matches (`EmptyState`)

| Variant | Anatomy |
|---|---|
| No matches at all | Sand panel, `xl` radius, 28 to 52 padding. Three decorative arches (dashed, solid with a diamond, dashed). Title "No more members fit all your must-haves right now." at 22 to 26 / 700. One row per relaxation hint (22 sliders icon, 18 text, the dimension and the count in bold), then the age line with a clock icon when it applies. Review preferences (primary, large) and Search (secondary, large). |
| End of the row | A card-width sand panel with `lg` radius at the end of the matches row: a 64 x 80 dashed arch with a diamond, "You have seen everyone who fits your must-haves. Loosen one to see more." at 21 / 700, the same hint rows at 17, and Review preferences (secondary, full width) pinned to the bottom. |

### 6.16 Top bar

| Where | Anatomy |
|---|---|
| Phone, Home | At least 64 tall. Wordmark (arch logo and serif 24, wraps at larger text) at the start, bell (48, 26 icon) with a dark count badge at the end that grows upwards, away from the bell. |
| Phone, Profile | 64 tall. Back (48), the name at 19 / 700 (the only place a name is cut, because the full name is right below), then Shortlist and More as 56 tall icon-and-label buttons (15 / 600 labels). |
| Wide | 80 tall. Wordmark at 28, five navigation pills (48 tall, 17 / 600, the current one in primary soft with primary text), count badges, a Notifications pill and the account arch monogram with the name. Labels for Notifications and the account name hide below 1,100. At larger text the bar wraps. |

### 6.17 Bottom navigation (phone)

Five destinations, 64 tall plus the inset, with equal widths and at least 6 between labels; at larger text they wrap onto a second row, and no label is cut. Each item: a 60 x 32 indicator pill (primary soft when current), a 24 icon, the label at 15 (600, or 700 in primary when current). Count badges are at least 22 tall dark or primary pills at 15 / 700; the "Me" attention mark is a 9 gold diamond with screen reader text. Compose: `NavigationBar` with `indicatorColor` from `secondaryContainer`.

### 6.18 Menu

Surface, hairline border, `lg` radius, menu shadow, 8 padding. Items 48 tall at least, 17 text, 14 radius, sand on hover. Items may wrap to two lines ("Let Muhammad Abdul Rehman S. see my photos"). Opening moves focus to the first item; Escape closes the menu and returns focus to its button.

### 6.19 Count badge

Pill, at least 24 tall (22 in tab bars) and taller with larger text, line height 1.4, 7 side padding, 15 / 700 tabular (`labelSmall`). Primary for interests, inverse for chats and notifications. Always paired with words for screen readers ("3 new").

### 6.20 Toast

Inverse surface, on-inverse text at 17, action in gold on inverse, `lg` radius, menu shadow. Stays 5 seconds when it carries an Undo.

### 6.21 Nudge card and the top of Home on phones

A nudge card is one sand link on the page background, after the matches row: a 46 x 56 arch with its icon, the title (18 / 700) over its text (`bodySmall`, secondary colour), then a chevron. On wide screens the nudges share one row of equal columns.

The pending interests callout is its text and View (inverse, 56 tall) at every size, without photos: `GET /v1/home` sends only a count.

On phones (under 768) the top of Home gives way to the matches, so the first match's name and % show on the first screen at 360 x 800 and 390 x 844, with the photo starting about 331 below the top:

1. The greeting monogram is 44 x 55 (2 by 2.5 em, so it grows with the text).
2. The callout is one row that wraps at larger text, its text at 18 / 700, and the matches heading has no ornament.
3. The nudges form one row that scrolls sideways, edge to edge, the next card peeking in. Each card is 72 tall with a 36 x 44 arch and the title only; the text stays for screen readers.

"See all" is a text link (6.2) in every section.

## 7. Edge cases

| Case | Rule |
|---|---|
| Long names ("Muhammad Abdul Rehman S., 32") | Wrap on cards, in headings, banners, dialogs and menus. Only the phone top bar truncates with an ellipsis. Sentences that embed the name ("You fit 92% of what {name} is looking for") wrap normally. |
| Overseas members | Cards add the country when it differs from the viewer's: "Birmingham, United Kingdom". The profile shows city, region and country, then nationality and residency status. |
| Long reference labels | Education levels such as "Professional degree (MBBS, BDS, Pharm-D, LLB, CA, ACCA)" wrap to two lines inside profile rows. Do not abbreviate them in the client. |
| No photos | The arch keeps its shape: lattice, inner arch, monogram, "No photo added yet". The gallery shows no arrows or dots. |
| Private photos | Blurred photo, veil and monogram, "{name}'s photos are private" with Request photos; after a request: "Photo request sent. You will be notified when it is approved." The photo count still shows. |
| End of matches | The end-of-row card closes the matches row. |
| No matches | The empty panel replaces the row. Rows that depend on the same pool (new members, near you) are hidden rather than padded. |
| Interest received | The interest banner sits on top of the action bar; Accept is primary, Decline asks for confirmation. |
| Font scale 200% | Cards grow taller, rows stack label over value, buttons go full width. No horizontal scrolling except the card rows, which already scroll. |

## 8. Accessibility checklist

1. Every interactive element is at least 48 x 48, with 8 or more between neighbours.
2. Every status has an icon and words, and every icon-only control has a label ("Back", "Notifications, 4 new").
3. A card has one link, the name, stretched over the whole card; the photo is not a separate link. The photo's state ("Photos private", "No photo added yet") and count are read out after the name, and each card is named by the member's name. On Android the whole card is one focusable item with custom actions (`specs/22` section 12).
4. Switches, checkboxes and pressed toggles expose their state (`role="switch"`, `role="checkbox"`, `aria-pressed`; `toggleable` and `selectable` in Compose).
5. Focus is always visible: 3 px primary ring, 3 px offset.
6. Text contrast meets the ratios in section 2.1 on the surface where it is used.

## 9. Spec alignment found during the audit

The redesign follows the specs; the audit corrected these places in the earlier drafts:

1. `managed_by` uses the labels of `specs/05` section 2.2 ("Profile managed by Parent", not "Mother"), and the line is hidden when the profile is managed by the member (`specs/16` section 1.5).
2. Card location shows the country only when it differs from the viewer's ("Lahore", not "Lahore, Pakistan").
3. Reasons use only the closed list of `specs/10` section 7 ("Lives in your city", not "Same city"; "Willing to relocate" is not a reason).
4. Cards show the marital status only when it is not "Never married", and no children count.
5. Education shows the level names of `specs/05` section 7, and employment the labels of section 2.11 ("Private job").
6. "Lives in" on the profile includes the country name.
7. The About block has no "Written by" line: there is no such field.
8. The pending interests text is singular for one ("1 member is interested in you").
9. Open question for the specs: siblings are written "{n}, {m} married", which reads as "1, 0 married" when none is married. "1, not married" would read better.

The first design critique (2026-11-22) changed the specs and this file together:

1. The full-size card shows only what helps decide whether to open a profile. Education, height, religion or sect, caste and activity moved to the profile (`specs/16` section 1.5, 6.9 here).
2. Shortlist is a labelled toggle ("Shortlist", "Shortlisted") on cards and on the profile, not a bare heart (`specs/16` sections 1.5 and 6.4, and `APP-PROFILE`).
3. "Not interested" on a list leaves a panel with Undo in place of the card, with no time limit, instead of a 5-second toast (`specs/16` section 6.4, `specs/11` section 12). The profile screen keeps its toast.
4. Badges are words with a tick, never icons alone, and "New" sits on the photo (`specs/12` section 1.2).
5. Count badges, the "New" chip and the phone top bar labels moved from 14 to 15, quiet buttons got a control border (3.6:1), and the serif minimum is stated once (section 1).
6. The reasons "Verified profile" and "New member" were removed, because they always repeated a badge (`specs/10` section 7).

The second critique, the same day, changed these:

1. On a managed profile every line about the candidate uses their name or he and she (`specs/16` section 1.1, `specs/07` section 3.2).
2. On Home the nudges follow the matches, "Near you" is a list of compact cards and "New members" uses the tile, which now carries the % (`specs/16` sections 1.5 and 6.4).
3. Badges sit by the name again, the % shares the name's line, and on phones a card keeps its own height (6.9).
4. A tick means verified, the envelope means an interest, the heart means Shortlist (6.6, 6.7).
5. Larger text wraps buttons, bars and tabs instead of clipping them or scrolling the page, and the focus ring inverts on primary bands.

## 10. Adoption checklist

Web (`apps/web`):

1. Replace the `@theme` block in `src/styles/app.css` with sections 2.4, 3.3 and the radius, size, shadow and motion variables of sections 4 and 5.
2. Swap `@fontsource-variable/inter` for `@fontsource-variable/source-sans-3` and add `@fontsource/instrument-serif`.
3. Move the match badge from `accent` to `success`, and set body text to 17 / 26.
4. Update `specs/17-web-app.md` section 9.3 to point at this file.

Android (`apps/android`):

1. Replace `Brand`, `LightColors`, `ExtendedColors`, `AppTypography` and `AppShapes` in `ui/theme/Theme.kt` with sections 2.5, 3.4 and 4.1, and add `Spacing`, `Sizes` and `KrType`.
2. Add the font files to `res/font` and remove the gradients and the photo scrim.
3. Give buttons, chips and the navigation indicator the pill shape, and cards `shapes.large`.
4. Update `specs/22-android-app.md` section 12 to point at this file.

Both: check contrast with the final assets, and test at 200% font scale on a 360 dp wide phone.
