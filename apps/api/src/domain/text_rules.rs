//! Text rules: the synchronous validators for member-written text (13 section 3).
//!
//! Two layers exist in the product. This module is the first one: it runs inside the request and
//! rejects bad input at once. The asynchronous `moderate_text` check (13 section 3.7) is a job and
//! lives elsewhere.
//!
//! Handlers call [`validate`] (or [`check`]) with a [`TextField`] and the text as received:
//!
//! 1. The text is tidied to its stored form: trimmed, whitespace collapsed (13 section 3.2).
//! 2. The length limits of the field are checked (`too_short`, `too_long`).
//! 3. The character rule of the field is checked (`invalid`): the name pattern `N1`, the short
//!    text pattern `S1`, or "no control characters" for long text (13 section 3.3).
//! 4. The contact patterns run on the normalised copy (`contains_contact_info`, 13 section 3.4).
//! 5. The banned words run on the normalised copy (`inappropriate`, 13 section 3.6).
//!
//! The first failure wins. Chat message bodies, shortlist notes, saved search names, report
//! details and the phone and email fields of `profile_contacts` are deliberately not
//! [`TextField`]s: 13 section 3.1 says they get length limits only. Chat has its own notices
//! (see `chat_safety`).

use std::borrow::Cow;
use std::fmt;
use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::UnicodeNormalization;

/// Message for the field code `contains_contact_info` (13 section 3.4).
pub const CONTACT_INFO_MESSAGE: &str = "Please remove phone numbers, email addresses, links and social media names. You can share contact details privately once you are connected.";

/// Message for the field code `inappropriate` (13 section 3.6).
pub const INAPPROPRIATE_MESSAGE: &str =
    "Please keep the wording respectful and suitable for a family platform.";

// ---------------------------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------------------------

/// A rule a text broke. Maps one to one to a field error code of 15 section 2.2.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextViolation {
    /// Field code `too_short`.
    TooShort,
    /// Field code `too_long`.
    TooLong,
    /// Field code `invalid`: a character rule failed (13 section 3.3).
    Invalid,
    /// Field code `contains_contact_info` (13 section 3.4).
    ContainsContactInfo,
    /// Field code `inappropriate` (13 section 3.6).
    Inappropriate,
}

impl TextViolation {
    /// The field error code of 15 section 2.2.
    pub const fn code(self) -> &'static str {
        match self {
            Self::TooShort => "too_short",
            Self::TooLong => "too_long",
            Self::Invalid => "invalid",
            Self::ContainsContactInfo => "contains_contact_info",
            Self::Inappropriate => "inappropriate",
        }
    }

    /// An English message for the `message` of the field error. Clients prefer their own text for
    /// a known field and code (07 section 16); this is the fallback. The two messages of 13
    /// section 3.4 and 3.6 are fixed by the spec.
    pub fn message(self, field: TextField) -> Cow<'static, str> {
        let rules = field.rules();
        match self {
            Self::ContainsContactInfo => Cow::Borrowed(CONTACT_INFO_MESSAGE),
            Self::Inappropriate => Cow::Borrowed(INAPPROPRIATE_MESSAGE),
            Self::Invalid => Cow::Borrowed(match rules.charset {
                Charset::Name40 | Charset::Name80 => {
                    "Use letters only. Numbers and symbols are not allowed in a name."
                }
                Charset::Short => "Use only letters, numbers and basic punctuation.",
                Charset::Free => "This text contains characters that are not allowed.",
            }),
            Self::TooShort | Self::TooLong if field.group() == TextGroup::Name => Cow::Owned(
                format!("Enter a name of {} to {} characters.", rules.min, rules.max),
            ),
            Self::TooShort => Cow::Owned(format!("Enter at least {} characters.", rules.min)),
            Self::TooLong => Cow::Owned(format!("Use at most {} characters.", rules.max)),
        }
    }
}

impl fmt::Display for TextViolation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for TextViolation {}

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

/// The three groups of 13 section 3.1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextGroup {
    /// Group A: names. Name pattern and banned words.
    Name,
    /// Group B: short free text. Character pattern, contact patterns and banned words.
    ShortText,
    /// Group C: long free text. Contact patterns and banned words; line breaks allowed.
    LongText,
}

/// Every member-written text field the synchronous rules apply to (13 section 3.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TextField {
    // Group A.
    FirstName,
    LastName,
    ManagerName,
    GuardianName,
    // Group B.
    JobTitle,
    EmployerName,
    InstituteName,
    DegreeTitle,
    FatherOccupation,
    MotherOccupation,
    Area,
    CityOther,
    OriginOther,
    CasteOther,
    SubCasteOther,
    DisabilityDetails,
    /// The group table of 13 section 3.1 lists it as "not checked", but 08 section 3.3 says the
    /// free text rules do apply to it. It gets the contact patterns and the banned words, and no
    /// character pattern (so "7:30 pm" is fine).
    BestTimeToCall,
    // Group C.
    AboutMe,
    AboutFamily,
    /// Partner preference `notes`.
    PartnerNotes,
    /// The `message` of an interest (11 section 2.2).
    InterestMessage,
}

impl TextField {
    /// Every field.
    pub const ALL: &'static [Self] = &[
        Self::FirstName,
        Self::LastName,
        Self::ManagerName,
        Self::GuardianName,
        Self::JobTitle,
        Self::EmployerName,
        Self::InstituteName,
        Self::DegreeTitle,
        Self::FatherOccupation,
        Self::MotherOccupation,
        Self::Area,
        Self::CityOther,
        Self::OriginOther,
        Self::CasteOther,
        Self::SubCasteOther,
        Self::DisabilityDetails,
        Self::BestTimeToCall,
        Self::AboutMe,
        Self::AboutFamily,
        Self::PartnerNotes,
        Self::InterestMessage,
    ];

    /// The key of the field in the request body, for the `field` of a field error (15 section 2).
    pub const fn name(self) -> &'static str {
        match self {
            Self::FirstName => "first_name",
            Self::LastName => "last_name",
            Self::ManagerName => "manager_name",
            Self::GuardianName => "guardian_name",
            Self::JobTitle => "job_title",
            Self::EmployerName => "employer_name",
            Self::InstituteName => "institute_name",
            Self::DegreeTitle => "degree_title",
            Self::FatherOccupation => "father_occupation",
            Self::MotherOccupation => "mother_occupation",
            Self::Area => "area",
            Self::CityOther => "city_other",
            Self::OriginOther => "origin_other",
            Self::CasteOther => "caste_other",
            Self::SubCasteOther => "sub_caste_other",
            Self::DisabilityDetails => "disability_details",
            Self::BestTimeToCall => "best_time_to_call",
            Self::AboutMe => "about_me",
            Self::AboutFamily => "about_family",
            Self::PartnerNotes => "notes",
            Self::InterestMessage => "message",
        }
    }

    /// The group of 13 section 3.1.
    pub const fn group(self) -> TextGroup {
        match self {
            Self::FirstName | Self::LastName | Self::ManagerName | Self::GuardianName => {
                TextGroup::Name
            }
            Self::AboutMe | Self::AboutFamily | Self::PartnerNotes | Self::InterestMessage => {
                TextGroup::LongText
            }
            _ => TextGroup::ShortText,
        }
    }

    /// The smallest allowed length in characters of a non-empty value. An empty value is not a
    /// violation: whether it is allowed is the caller's decision (see [`validate`]).
    ///
    /// Sources: the `CHECK` constraints of 04 section 5 and 07 sections 4 to 9 (`about_me` at
    /// least 50, `about_family` and partner `notes` at least 30 when not empty).
    pub const fn min_chars(self) -> usize {
        match self {
            Self::FirstName
            | Self::LastName
            | Self::ManagerName
            | Self::GuardianName
            | Self::CityOther
            | Self::CasteOther
            | Self::SubCasteOther => 2,
            Self::AboutMe => 50,
            Self::AboutFamily | Self::PartnerNotes => 30,
            _ => 1,
        }
    }

    /// The largest allowed length in characters (Unicode scalar values, like PostgreSQL
    /// `char_length`). Sources as for [`TextField::min_chars`].
    pub const fn max_chars(self) -> usize {
        match self {
            Self::FirstName | Self::LastName => 40,
            Self::ManagerName
            | Self::GuardianName
            | Self::JobTitle
            | Self::DegreeTitle
            | Self::FatherOccupation
            | Self::MotherOccupation
            | Self::Area
            | Self::BestTimeToCall => 80,
            Self::EmployerName | Self::InstituteName => 120,
            Self::CityOther | Self::OriginOther | Self::CasteOther | Self::SubCasteOther => 60,
            Self::DisabilityDetails | Self::InterestMessage => 300,
            Self::AboutMe => 1500,
            Self::AboutFamily | Self::PartnerNotes => 1000,
        }
    }

    /// Whether line breaks are kept in the stored value (long text only).
    pub const fn is_multiline(self) -> bool {
        matches!(self.group(), TextGroup::LongText)
    }

    /// The stored form of `raw`: trimmed, with whitespace collapsed (13 section 3.2). Single-line
    /// fields use [`tidy_line`], long text uses [`tidy_multiline`].
    pub fn tidy(self, raw: &str) -> String {
        if self.is_multiline() {
            tidy_multiline(raw)
        } else {
            tidy_line(raw)
        }
    }

    fn rules(self) -> Rules {
        let (charset, contact) = match self.group() {
            TextGroup::Name => (
                if self.max_chars() > 40 {
                    Charset::Name80
                } else {
                    Charset::Name40
                },
                None,
            ),
            TextGroup::ShortText => {
                let charset = if self == Self::BestTimeToCall {
                    Charset::Free
                } else {
                    Charset::Short
                };
                // U2 is not applied to employer and institute names (13 section 3.4, step 5).
                let scope = if matches!(self, Self::EmployerName | Self::InstituteName) {
                    ContactScope::WithoutBareDomains
                } else {
                    ContactScope::Full
                };
                (charset, Some(scope))
            }
            TextGroup::LongText => (Charset::Free, Some(ContactScope::Full)),
        };
        Rules {
            min: self.min_chars(),
            max: self.max_chars(),
            charset,
            contact,
        }
    }
}

/// How a field is checked, derived from its group. The banned words apply to every field.
#[derive(Debug, Clone, Copy)]
struct Rules {
    min: usize,
    max: usize,
    charset: Charset,
    /// `None`: the contact patterns do not apply (names).
    contact: Option<ContactScope>,
}

/// The character rule of a field (13 section 3.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Charset {
    /// Pattern `N1`, 2 to 40 characters.
    Name40,
    /// Pattern `N1` with the longer repetition, 2 to 80 characters.
    Name80,
    /// Pattern `S1`.
    Short,
    /// Any characters except control characters other than line breaks.
    Free,
}

// ---------------------------------------------------------------------------------------------
// Tidying and normalising
// ---------------------------------------------------------------------------------------------

/// Collapses every run of whitespace, line breaks included, to one space and trims (13 section
/// 3.2, step 5; 07 section 4.2 rule 1). The stored form of every single-line field.
pub fn tidy_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for word in text.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out
}

/// The stored form of long text: each line trimmed and the whitespace inside a line collapsed to
/// single spaces, but with line breaks kept. Every kind of line break (`\r\n`, `\r`, `\n`, U+0085,
/// U+2028, U+2029) becomes `\n`; leading and trailing blank lines are dropped and any run of
/// blank lines becomes one blank line.
///
/// 13 section 3.2 says the stored value is the original text "after trimming and collapsing
/// whitespace", and 3.3 says long text accepts line breaks. Read together, line breaks must
/// survive in the stored value of a multi-line field, so only horizontal whitespace is collapsed
/// here.
pub fn tidy_multiline(text: &str) -> String {
    let unified = text
        .replace("\r\n", "\n")
        .replace(['\r', '\u{0085}', '\u{2028}', '\u{2029}'], "\n");
    let mut out = String::with_capacity(unified.len());
    let mut blank_line_pending = false;
    for line in unified.split('\n') {
        let line = tidy_line(line);
        if line.is_empty() {
            blank_line_pending = !out.is_empty();
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
            if blank_line_pending {
                out.push('\n');
            }
        }
        out.push_str(&line);
        blank_line_pending = false;
    }
    out
}

/// The normalised copy every contact, banned-word and chat pattern runs on (13 section 3.2):
///
/// 1. Unicode NFKC (full-width digits and letters become ASCII).
/// 2. Arabic-Indic digits U+0660 to U+0669 and extended Arabic-Indic digits U+06F0 to U+06F9
///    become ASCII digits.
/// 3. The zero-width characters U+200B, U+200C, U+200D, U+2060 and U+FEFF are removed.
/// 4. Lowercase.
/// 5. Every run of whitespace, line breaks included, becomes one space; trimmed.
///
/// The input should already be length-checked: NFKC can expand some characters.
pub fn normalize(text: &str) -> String {
    let mut mapped = String::with_capacity(text.len());
    for c in text.nfkc() {
        match c {
            '\u{0660}'..='\u{0669}' => push_digit(&mut mapped, u32::from(c) - 0x0660),
            '\u{06F0}'..='\u{06F9}' => push_digit(&mut mapped, u32::from(c) - 0x06F0),
            '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}' => {}
            _ => mapped.push(c),
        }
    }
    tidy_line(&mapped.to_lowercase())
}

fn push_digit(out: &mut String, value: u32) {
    // `value` is 0 to 9 by construction of the callers; the fallback is never taken.
    out.push(char::from_digit(value, 10).unwrap_or('0'));
}

/// The key used to group typed caste, sub-caste and city values (05 section 7, 07 section 5.2):
/// the trimmed value in lowercase with runs of whitespace collapsed to one space. This is
/// deliberately lighter than [`normalize`].
pub fn suggestion_key(text: &str) -> String {
    tidy_line(text).to_lowercase()
}

// ---------------------------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------------------------

/// Compiles a pattern that is a constant of this file. A failure is a programming error, and the
/// `every_pattern_compiles` test fails first.
fn compile(source: &str) -> Regex {
    Regex::new(source).expect("constant pattern compiles")
}

/// `N1` (13 section 3.3), 2 to 40 characters.
static N1_40: LazyLock<Regex> =
    LazyLock::new(|| compile(r"^[\p{L}\p{M}][\p{L}\p{M} .'\-]{0,38}[\p{L}\p{M}.]$"));
/// `N1` with a repetition of `{0,78}`, 2 to 80 characters.
static N1_80: LazyLock<Regex> =
    LazyLock::new(|| compile(r"^[\p{L}\p{M}][\p{L}\p{M} .'\-]{0,78}[\p{L}\p{M}.]$"));
/// `S1` (13 section 3.3).
static S1: LazyLock<Regex> = LazyLock::new(|| compile(r"^[\p{L}\p{M}\p{N} .,'&()/+\-]+$"));
/// One letter, for the extra name rules.
static LETTER: LazyLock<Regex> = LazyLock::new(|| compile(r"\p{L}"));

/// `X1`: year ranges (13 section 3.4, step 1).
static X1: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\b(?:19|20)\d{2} ?(?:-|to|till|until) ?(?:19|20)\d{2}\b"));
/// `X2`: dates (13 section 3.4, step 1).
static X2: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\b\d{1,2}[/.\-]\d{1,2}[/.\-](?:19|20)?\d{2}\b"));
/// `P1`: eight or more digits with at most two separators after each.
static P1: LazyLock<Regex> = LazyLock::new(|| compile(r"(?:\d[ .\-_()*]{0,2}){8,}"));
/// `E1`: an email address.
static E1: LazyLock<Regex> =
    LazyLock::new(|| compile(r"[a-z0-9._%+\-]+ ?@ ?[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}"));
/// `E2`: an email address written with "at".
static E2: LazyLock<Regex> = LazyLock::new(|| {
    compile(
        r"[a-z0-9._%+\-]+(?: ?\(at\) ?| ?\[at\] ?| at )(?:gmail|yahoo|hotmail|outlook|icloud|live|ymail|proton|protonmail)\b",
    )
});
/// `E3`: a mail provider written as a domain.
static E3: LazyLock<Regex> = LazyLock::new(|| {
    compile(r"\b(?:gmail|hotmail|yahoo|outlook|icloud|ymail)\b ?(?:\.|dot) ?com\b")
});
/// `U1`: a link with a scheme or `www.`.
static U1: LazyLock<Regex> = LazyLock::new(|| compile(r"(?:https?://|www\.)\S+"));
/// `U2`: a bare domain name.
static U2: LazyLock<Regex> =
    LazyLock::new(|| compile(r"\b[a-z0-9][a-z0-9\-]+\.(?:com|net|org|pk|io|info|biz|app|link)\b"));
/// `H1`: an `@handle`.
static H1: LazyLock<Regex> = LazyLock::new(|| compile(r"(?:^|[^a-z0-9._%+\-])@[a-z0-9_.]{3,}"));
/// `H2`: a platform name followed by a handle trigger.
static H2: LazyLock<Regex> = LazyLock::new(|| {
    compile(
        r"\b(?:insta|instagram|snap|snapchat|fb|facebook|tiktok|telegram|whatsapp|whats app|watsapp|wtsapp|skype|imo|botim)\b[^.\n]{0,20}?(?:@|\bid\b|:|\d)",
    )
});

/// The banned words and phrases (13 section 3.6), compiled into the binary.
const BANNED_WORDS_SOURCE: &str = include_str!("../moderation/banned_words.txt");

/// One alternation of every banned phrase, whole words or phrases only. `None` when the list is
/// empty.
static BANNED_WORDS: LazyLock<Option<Regex>> =
    LazyLock::new(|| banned_words_regex(BANNED_WORDS_SOURCE));

/// Parses the banned-words file: one phrase per line, `#` for comments, lowercase.
fn banned_phrases(source: &str) -> Vec<String> {
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(suggestion_key)
        .collect()
}

fn banned_words_regex(source: &str) -> Option<Regex> {
    let phrases = banned_phrases(source);
    if phrases.is_empty() {
        return None;
    }
    let alternation = phrases
        .iter()
        .map(|phrase| regex::escape(phrase))
        .collect::<Vec<_>>()
        .join("|");
    Some(compile(&format!(r"\b(?:{alternation})\b")))
}

/// Compiles every pattern now, so that a broken pattern stops the start-up instead of failing the
/// first request (13 section 3.4: "All patterns are compiled once at startup").
pub fn init() {
    for pattern in [
        &N1_40, &N1_80, &S1, &LETTER, &X1, &X2, &P1, &E1, &E2, &E3, &U1, &U2, &H1, &H2,
    ] {
        LazyLock::force(pattern);
    }
    LazyLock::force(&BANNED_WORDS);
}

// ---------------------------------------------------------------------------------------------
// Contact patterns
// ---------------------------------------------------------------------------------------------

/// Which of the contact patterns of 13 section 3.4 run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContactScope {
    /// Every pattern: phones, emails, links and social handles.
    Full,
    /// Every pattern except `U2` (bare domain names). For `employer_name` and `institute_name`.
    WithoutBareDomains,
    /// `P1`, `C0`, `E1`, `E2` and `E3` only. What chat notices look for (13 section 5.2).
    PhoneAndEmail,
}

/// The pattern that matched, named as in 13 section 3.4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContactPattern {
    /// Eight or more digits.
    P1,
    /// A phone number written in words.
    C0,
    /// An email address.
    E1,
    /// An email address written with "at".
    E2,
    /// A mail provider written as a domain.
    E3,
    /// A link with a scheme or `www.`.
    U1,
    /// A bare domain name.
    U2,
    /// An `@handle`.
    H1,
    /// A platform name followed by a handle trigger.
    H2,
}

/// Looks for contact details in text that is already [`normalize`]d, in the order of 13 section
/// 3.4: the exemptions `X1` and `X2` first (their matches are replaced by a space, and the later
/// patterns see the result), then `P1`, `C0`, `E1`, `E2`, `E3`, `U1`, `U2`, `H1`, `H2`. The first
/// match wins.
pub fn find_contact(normalized: &str, scope: ContactScope) -> Option<ContactPattern> {
    let without_ranges = X1.replace_all(normalized, " ");
    let exempted = X2.replace_all(&without_ranges, " ");
    let text = exempted.as_ref();

    if P1.is_match(text) {
        return Some(ContactPattern::P1);
    }
    if has_spoken_phone_number(text) {
        return Some(ContactPattern::C0);
    }
    if E1.is_match(text) {
        return Some(ContactPattern::E1);
    }
    if E2.is_match(text) {
        return Some(ContactPattern::E2);
    }
    if E3.is_match(text) {
        return Some(ContactPattern::E3);
    }
    if scope == ContactScope::PhoneAndEmail {
        return None;
    }
    if U1.is_match(text) {
        return Some(ContactPattern::U1);
    }
    if scope == ContactScope::Full && U2.is_match(text) {
        return Some(ContactPattern::U2);
    }
    if H1.is_match(text) {
        return Some(ContactPattern::H1);
    }
    if H2.is_match(text) {
        return Some(ContactPattern::H2);
    }
    None
}

/// Whether the token is one of the number words of `C0`, each standing for one digit: `zero`
/// `sifar` (0), `one` `aik` `ek` (1), `two` `do` (2), `three` `teen` (3), `four` `char` `chaar`
/// (4), `five` `panch` `paanch` (5), `six` `chay` `chhay` `che` (6), `seven` `saat` (7), `eight`
/// `aath` (8), `nine` `nau` (9) (13 section 3.4, step 3).
fn is_number_word(word: &str) -> bool {
    matches!(
        word,
        "zero"
            | "sifar"
            | "one"
            | "aik"
            | "ek"
            | "two"
            | "do"
            | "three"
            | "teen"
            | "four"
            | "char"
            | "chaar"
            | "five"
            | "panch"
            | "paanch"
            | "six"
            | "chay"
            | "chhay"
            | "che"
            | "seven"
            | "saat"
            | "eight"
            | "aath"
            | "nine"
            | "nau"
    )
}

/// A "number token" of `C0`: how many digits it stands for, and whether it is a word. A token is
/// a number token when it is 1 to 4 ASCII digits or one of the number words (each stands for one
/// digit).
fn number_token(token: &str) -> Option<(usize, bool)> {
    if (1..=4).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_digit()) {
        return Some((token.len(), false));
    }
    is_number_word(token).then_some((1, true))
}

/// A maximal run of consecutive number tokens.
#[derive(Debug, Default)]
struct SpokenRun {
    tokens: usize,
    words: usize,
    digits: usize,
}

impl SpokenRun {
    fn push(&mut self, digits: usize, is_word: bool, repeat: usize) {
        self.tokens += 1;
        self.words += usize::from(is_word);
        self.digits += digits * repeat;
    }

    /// At least 6 tokens, at least 2 of them words, at least 8 digits in total.
    const fn is_phone_number(&self) -> bool {
        self.tokens >= 6 && self.words >= 2 && self.digits >= 8
    }
}

/// `C0` (13 section 3.4, step 3): a phone number written in words, such as
/// `zero three double zero 12 34 567`.
///
/// "double" and "triple" directly before a number token belong to the run and repeat that token's
/// digits. They are not themselves counted as tokens or as words, which is the conservative
/// reading of "at least 6 tokens, at least 2 of them words".
fn has_spoken_phone_number(text: &str) -> bool {
    let mut tokens = text
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .filter(|token| !token.is_empty())
        .peekable();
    let mut run = SpokenRun::default();
    while let Some(token) = tokens.next() {
        if let Some((digits, is_word)) = number_token(token) {
            run.push(digits, is_word, 1);
            continue;
        }
        let repeat = match token {
            "double" => 2,
            "triple" => 3,
            _ => 1,
        };
        if repeat > 1
            && let Some((digits, is_word)) = tokens.peek().copied().and_then(number_token)
        {
            tokens.next();
            run.push(digits, is_word, repeat);
            continue;
        }
        // Any other token ends the run.
        if run.is_phone_number() {
            return true;
        }
        run = SpokenRun::default();
    }
    run.is_phone_number()
}

// ---------------------------------------------------------------------------------------------
// Banned words
// ---------------------------------------------------------------------------------------------

/// Whether the [`normalize`]d text contains a banned word or phrase as a whole word or phrase
/// (13 section 3.6).
pub fn has_banned_word(normalized: &str) -> bool {
    BANNED_WORDS
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(normalized))
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/// Tidies `raw` to its stored form and validates it for `field`.
///
/// Returns `Ok(None)` when nothing is left after tidying: the caller decides whether an empty
/// value means `NULL` (optional field) or the field code `required`. Otherwise returns the value
/// to store.
///
/// # Errors
///
/// The first rule the text breaks: length, character rule, contact details, banned words.
pub fn validate(field: TextField, raw: &str) -> Result<Option<String>, TextViolation> {
    let stored = field.tidy(raw);
    if stored.is_empty() {
        return Ok(None);
    }
    check_length(field, &stored)?;
    check_content(field, &stored)?;
    Ok(Some(stored))
}

/// [`validate`] without the stored value, for callers that only need the verdict.
///
/// # Errors
///
/// As [`validate`].
pub fn check(field: TextField, text: &str) -> Result<(), TextViolation> {
    validate(field, text).map(|_| ())
}

fn check_length(field: TextField, stored: &str) -> Result<(), TextViolation> {
    let length = stored.chars().count();
    if length < field.min_chars() {
        Err(TextViolation::TooShort)
    } else if length > field.max_chars() {
        Err(TextViolation::TooLong)
    } else {
        Ok(())
    }
}

/// Every rule except the length: character rule, contact patterns, banned words.
fn check_content(field: TextField, stored: &str) -> Result<(), TextViolation> {
    let rules = field.rules();
    match rules.charset {
        Charset::Name40 => check_name(&N1_40, stored)?,
        Charset::Name80 => check_name(&N1_80, stored)?,
        Charset::Short => {
            if !S1.is_match(stored) {
                return Err(TextViolation::Invalid);
            }
        }
        Charset::Free => {
            if stored.chars().any(|c| c.is_control() && c != '\n') {
                return Err(TextViolation::Invalid);
            }
        }
    }
    let normalized = normalize(stored);
    if let Some(scope) = rules.contact
        && find_contact(&normalized, scope).is_some()
    {
        return Err(TextViolation::ContainsContactInfo);
    }
    if has_banned_word(&normalized) {
        return Err(TextViolation::Inappropriate);
    }
    Ok(())
}

/// `N1` plus the extra name rules of 13 section 3.3: at least two letters and not one letter
/// repeated for the whole value. ("Not only full stops and spaces" is already implied by `N1`,
/// which must start with a letter.) A failure is `invalid`.
fn check_name(pattern: &Regex, stored: &str) -> Result<(), TextViolation> {
    if pattern.is_match(stored) && has_two_distinct_letters(stored) {
        Ok(())
    } else {
        Err(TextViolation::Invalid)
    }
}

fn has_two_distinct_letters(text: &str) -> bool {
    let mut letters = LETTER.find_iter(text).map(|m| m.as_str().to_lowercase());
    let Some(first) = letters.next() else {
        return false;
    };
    letters.any(|letter| letter != first)
}

#[cfg(test)]
mod tests {
    use super::TextViolation::{ContainsContactInfo, Inappropriate, Invalid, TooLong, TooShort};
    use super::*;

    /// The content rules of group C on `about_me`, without its length limits.
    fn about_me(input: &str) -> Result<(), TextViolation> {
        check_content(TextField::AboutMe, &tidy_multiline(input))
    }

    /// Every test string of 13 section 3.5. Rows 28 and 29 are written with escapes: full-width
    /// digits and extended Arabic-Indic digits.
    const SPEC_TABLE: &[(u8, &str, Result<(), TextViolation>)] = &[
        (
            1,
            "I am a software engineer from Lahore. My family is originally from Sialkot.",
            Ok(()),
        ),
        (2, "Call me on 0300 1234567", Err(ContainsContactInfo)),
        (
            3,
            "my number is 0 3 0 0 1 2 3 4 5 6 7",
            Err(ContainsContactInfo),
        ),
        (4, "0300-123-4567", Err(ContainsContactInfo)),
        (5, "+92 (300) 1234567", Err(ContainsContactInfo)),
        (
            6,
            "zero three zero zero one two three four five six seven",
            Err(ContainsContactInfo),
        ),
        (
            7,
            "sifar teen sifar sifar aik do teen char panch chay saat",
            Err(ContainsContactInfo),
        ),
        (
            8,
            "zero three double zero 12 34 567",
            Err(ContainsContactInfo),
        ),
        (9, "I earn 150000 per month", Ok(())),
        (
            10,
            "Studied at NUST 2015-2019 then worked 2019 to 2023",
            Ok(()),
        ),
        (11, "Born on 12-05-1995 in Karachi", Ok(())),
        (12, "My height is 5 feet 6 inches and weight 60 kg", Ok(())),
        (13, "House 12, street 4, block 5, phase 6 DHA", Ok(())),
        (
            14,
            "We are a respectable family with 3 brothers and 2 sisters",
            Ok(()),
        ),
        (
            15,
            "email me at ayesha.khan@gmail.com",
            Err(ContainsContactInfo),
        ),
        (16, "ayesha khan at gmail dot com", Err(ContainsContactInfo)),
        (17, "ayeshak (at) yahoo", Err(ContainsContactInfo)),
        (18, "find me on gmail.com", Err(ContainsContactInfo)),
        (19, "visit www.example.com", Err(ContainsContactInfo)),
        (20, "my shop is myshop.pk", Err(ContainsContactInfo)),
        (
            21,
            "I completed B.Com and M.Com from Punjab University",
            Ok(()),
        ),
        (22, "Insta: ayesha_k", Err(ContainsContactInfo)),
        (
            23,
            "@ayesha_khan on all platforms",
            Err(ContainsContactInfo),
        ),
        (24, "whatsapp id 12345", Err(ContainsContactInfo)),
        (25, "telegram: @rishta_agent", Err(ContainsContactInfo)),
        (
            26,
            "I am not active on Facebook or any social media",
            Ok(()),
        ),
        (27, "snapchat me anytime", Ok(())),
        (
            28,
            "\u{FF10}\u{FF13}\u{FF10}\u{FF10}\u{FF11}\u{FF12}\u{FF13}\u{FF14}\u{FF15}\u{FF16}\u{FF17}",
            Err(ContainsContactInfo),
        ),
        (
            29,
            "\u{06F0}\u{06F3}\u{06F0}\u{06F0}\u{06F1}\u{06F2}\u{06F3}\u{06F4}\u{06F5}\u{06F6}\u{06F7}",
            Err(ContainsContactInfo),
        ),
        (
            30,
            "Annual turnover is PKR 15000000",
            Err(ContainsContactInfo),
        ),
        (31, "Looking for a hookup", Err(Inappropriate)),
    ];

    #[test]
    fn spec_table_3_5_on_about_me_content() {
        for (number, input, expected) in SPEC_TABLE {
            assert_eq!(&about_me(input), expected, "test {number}: {input:?}");
        }
    }

    #[test]
    fn spec_table_3_5_through_the_full_pipeline() {
        // The interest message has no minimum length, so the whole of `validate` can be run.
        for (number, input, expected) in SPEC_TABLE {
            let got = validate(TextField::InterestMessage, input).map(|_| ());
            assert_eq!(&got, expected, "test {number}: {input:?}");
        }
    }

    #[test]
    fn spec_table_3_5_has_all_31_rows() {
        let numbers: Vec<u8> = SPEC_TABLE.iter().map(|(n, ..)| *n).collect();
        assert_eq!(numbers, (1..=31).collect::<Vec<u8>>());
    }

    #[test]
    fn which_pattern_matches_follows_the_spec_notes() {
        let hit = |text: &str| find_contact(&normalize(text), ContactScope::Full);
        assert_eq!(hit("Call me on 0300 1234567"), Some(ContactPattern::P1));
        assert_eq!(
            hit("zero three zero zero one two three four five six seven"),
            Some(ContactPattern::C0)
        );
        assert_eq!(
            hit("zero three double zero 12 34 567"),
            Some(ContactPattern::C0)
        );
        assert_eq!(
            hit("email me at ayesha.khan@gmail.com"),
            Some(ContactPattern::E1)
        );
        assert_eq!(
            hit("ayesha khan at gmail dot com"),
            Some(ContactPattern::E2)
        );
        assert_eq!(hit("ayeshak (at) yahoo"), Some(ContactPattern::E2));
        assert_eq!(hit("find me on gmail.com"), Some(ContactPattern::E3));
        assert_eq!(hit("visit www.example.com"), Some(ContactPattern::U1));
        assert_eq!(hit("my shop is myshop.pk"), Some(ContactPattern::U2));
        assert_eq!(
            hit("@ayesha_khan on all platforms"),
            Some(ContactPattern::H1)
        );
        assert_eq!(hit("Insta: ayesha_k"), Some(ContactPattern::H2));
        assert_eq!(hit("whatsapp id 12345"), Some(ContactPattern::H2));
    }

    #[test]
    fn phone_and_email_scope_ignores_links_and_handles() {
        let hit = |text: &str| find_contact(&normalize(text), ContactScope::PhoneAndEmail);
        assert_eq!(hit("visit www.example.com"), None);
        assert_eq!(hit("my shop is myshop.pk"), None);
        assert_eq!(hit("@ayesha_khan"), None);
        assert_eq!(hit("insta: ayesha_k"), None);
        assert_eq!(hit("0300 1234567"), Some(ContactPattern::P1));
        assert_eq!(hit("a@b.com"), Some(ContactPattern::E1));
    }

    #[test]
    fn bare_domains_are_allowed_for_employers_and_institutes_only() {
        for field in [TextField::EmployerName, TextField::InstituteName] {
            assert_eq!(check(field, "Acme.com Ltd"), Ok(()), "{field:?}");
            assert_eq!(check(field, "Daraz.pk"), Ok(()), "{field:?}");
            // Links and phone numbers are still refused.
            assert_eq!(check(field, "www.acme.com"), Err(ContainsContactInfo));
            assert_eq!(check(field, "Acme 0300 1234567"), Err(ContainsContactInfo));
        }
        assert_eq!(
            check(TextField::JobTitle, "Manager at acme.com"),
            Err(ContainsContactInfo)
        );
        assert_eq!(check(TextField::JobTitle, "B.Com graduate"), Ok(()));
    }

    // ---- Names (13 section 3.3 and 3.5) ----

    #[test]
    fn name_examples_of_the_spec() {
        let first = |text: &str| check(TextField::FirstName, text);
        assert_eq!(first("Ayesha"), Ok(()));
        assert_eq!(first("Muhammad Ali"), Ok(()));
        assert_eq!(first("O'Brien"), Ok(()));
        assert_eq!(first("\u{0639}\u{0627}\u{0626}\u{0634}\u{06C1}"), Ok(()));
        assert_eq!(first("A"), Err(TooShort));
        assert_eq!(first("Ali123"), Err(Invalid));
        assert_eq!(first("Ali 0300"), Err(Invalid));
        assert_eq!(first("...."), Err(Invalid));
        assert_eq!(first("aaaa"), Err(Invalid));
    }

    #[test]
    fn name_rules_in_detail() {
        let first = |text: &str| check(TextField::FirstName, text);
        // Must start with a letter, may end with a full stop, no trailing hyphen.
        assert_eq!(first("Md."), Ok(()));
        assert_eq!(first("-Ali"), Err(Invalid));
        assert_eq!(first("Ali-"), Err(Invalid));
        assert_eq!(first("Anne-Marie"), Ok(()));
        // At least two letters, and not one letter repeated.
        assert_eq!(first("A."), Err(Invalid));
        assert_eq!(first("Aa"), Err(Invalid));
        assert_eq!(first("a a a"), Err(Invalid));
        assert_eq!(first("Ali Ali"), Ok(()));
        // Symbols and digits.
        assert_eq!(first("Ali@Khan"), Err(Invalid));
        assert_eq!(first("Ali_Khan"), Err(Invalid));
        // Whitespace is collapsed before the checks.
        assert_eq!(
            validate(TextField::FirstName, "  Muhammad \n\t Ali  "),
            Ok(Some("Muhammad Ali".to_owned()))
        );
        assert_eq!(validate(TextField::FirstName, "  \n "), Ok(None));
    }

    #[test]
    fn name_lengths_differ_by_field() {
        let forty = "a".repeat(20) + "b" + &"a".repeat(19);
        assert_eq!(forty.chars().count(), 40);
        assert_eq!(check(TextField::FirstName, &forty), Ok(()));
        assert_eq!(check(TextField::LastName, &forty), Ok(()));
        let forty_one = format!("{forty}b");
        assert_eq!(check(TextField::FirstName, &forty_one), Err(TooLong));
        assert_eq!(check(TextField::LastName, &forty_one), Err(TooLong));
        assert_eq!(check(TextField::ManagerName, &forty_one), Ok(()));
        assert_eq!(check(TextField::GuardianName, &forty_one), Ok(()));
        let eighty = "ab".repeat(40);
        assert_eq!(check(TextField::ManagerName, &eighty), Ok(()));
        assert_eq!(
            check(TextField::ManagerName, &format!("{eighty}b")),
            Err(TooLong)
        );
        assert_eq!(
            check(TextField::GuardianName, &format!("{eighty}b")),
            Err(TooLong)
        );
    }

    #[test]
    fn names_are_checked_for_banned_words_not_for_contact_patterns() {
        assert_eq!(check(TextField::FirstName, "Escort"), Err(Inappropriate));
        assert_eq!(
            check(TextField::ManagerName, "Sugar Daddy"),
            Err(Inappropriate)
        );
        assert_eq!(
            check(TextField::ManagerName, "Haramzada Khan"),
            Err(Inappropriate)
        );
    }

    // ---- Short and long text ----

    #[test]
    fn short_text_uses_pattern_s1_then_contact_then_banned_words() {
        let job = |text: &str| check(TextField::JobTitle, text);
        assert_eq!(job("Senior Engineer (Backend) & Team Lead"), Ok(()));
        assert_eq!(job("Doctor / Surgeon, FCPS"), Ok(()));
        assert_eq!(job("Engineer #1"), Err(Invalid));
        // The character pattern comes first in the order of 13 section 3.1, so `@` and `:` are
        // `invalid` before the contact patterns can see them.
        assert_eq!(job("me@gmail.com"), Err(Invalid));
        assert_eq!(job("call 0300 1234567"), Err(ContainsContactInfo));
        assert_eq!(job("Escort"), Err(Inappropriate));
    }

    #[test]
    fn short_text_lengths_come_from_the_schema() {
        let limits = [
            (TextField::JobTitle, 80),
            (TextField::DegreeTitle, 80),
            (TextField::FatherOccupation, 80),
            (TextField::MotherOccupation, 80),
            (TextField::Area, 80),
            (TextField::EmployerName, 120),
            (TextField::InstituteName, 120),
            (TextField::CityOther, 60),
            (TextField::OriginOther, 60),
            (TextField::CasteOther, 60),
            (TextField::SubCasteOther, 60),
            (TextField::DisabilityDetails, 300),
            (TextField::BestTimeToCall, 80),
        ];
        for (field, max) in limits {
            assert_eq!(
                check(field, &"x".repeat(max)),
                Ok(()),
                "{field:?} at the limit"
            );
            assert_eq!(
                check(field, &"x".repeat(max + 1)),
                Err(TooLong),
                "{field:?} over the limit"
            );
        }
        for field in [
            TextField::CityOther,
            TextField::CasteOther,
            TextField::SubCasteOther,
        ] {
            assert_eq!(check(field, "x"), Err(TooShort), "{field:?}");
            assert_eq!(check(field, "Rajput"), Ok(()), "{field:?}");
        }
        assert_eq!(check(TextField::Area, "x"), Ok(()));
    }

    #[test]
    fn best_time_to_call_gets_the_free_text_rules_without_the_character_pattern() {
        let best = |text: &str| check(TextField::BestTimeToCall, text);
        assert_eq!(best("evenings after 7 pm"), Ok(()));
        assert_eq!(best("weekdays 7:30 pm to 9:00 pm"), Ok(()));
        assert_eq!(best("call 0300 1234567"), Err(ContainsContactInfo));
        assert_eq!(best("whatsapp me"), Ok(()));
        assert_eq!(best("insta: me"), Err(ContainsContactInfo));
    }

    #[test]
    fn long_text_limits_and_minimums() {
        // about_me: 50 to 1500.
        assert_eq!(check(TextField::AboutMe, &"x".repeat(49)), Err(TooShort));
        assert_eq!(check(TextField::AboutMe, &"x".repeat(50)), Ok(()));
        assert_eq!(check(TextField::AboutMe, &"x".repeat(1500)), Ok(()));
        assert_eq!(check(TextField::AboutMe, &"x".repeat(1501)), Err(TooLong));
        // about_family and partner notes: 30 to 1000.
        for field in [TextField::AboutFamily, TextField::PartnerNotes] {
            assert_eq!(check(field, &"x".repeat(29)), Err(TooShort), "{field:?}");
            assert_eq!(check(field, &"x".repeat(30)), Ok(()), "{field:?}");
            assert_eq!(check(field, &"x".repeat(1000)), Ok(()), "{field:?}");
            assert_eq!(check(field, &"x".repeat(1001)), Err(TooLong), "{field:?}");
        }
        // Interest message: at most 300, no minimum.
        assert_eq!(check(TextField::InterestMessage, "Hi"), Ok(()));
        assert_eq!(check(TextField::InterestMessage, &"x".repeat(300)), Ok(()));
        assert_eq!(
            check(TextField::InterestMessage, &"x".repeat(301)),
            Err(TooLong)
        );
        // Length is counted in characters, not bytes.
        assert_eq!(
            check(TextField::InterestMessage, &"\u{0639}".repeat(300)),
            Ok(())
        );
    }

    #[test]
    fn length_is_checked_after_collapsing_whitespace() {
        let padded = format!("   {}   \n\n", "x".repeat(300));
        assert_eq!(check(TextField::InterestMessage, &padded), Ok(()));
        let spaced = format!("{}{}", "x ".repeat(100), " ".repeat(500));
        assert_eq!(check(TextField::InterestMessage, &spaced), Ok(()));
    }

    #[test]
    fn long_text_rejects_control_characters_but_not_line_breaks() {
        assert_eq!(about_me("First line.\nSecond line."), Ok(()));
        assert_eq!(about_me("First line.\r\nSecond line."), Ok(()));
        assert_eq!(about_me("nul\u{0}byte"), Err(Invalid));
        assert_eq!(about_me("bell\u{7}"), Err(Invalid));
        assert_eq!(about_me("escape\u{1B}[0m"), Err(Invalid));
        assert_eq!(about_me("delete\u{7F}"), Err(Invalid));
        assert_eq!(about_me("c1 control\u{9F}"), Err(Invalid));
        // A tab is whitespace and is collapsed, not rejected.
        assert_eq!(about_me("a\tb"), Ok(()));
    }

    #[test]
    fn contact_details_across_line_breaks_are_still_found() {
        let text = "I live in Lahore.\nMy number is\n0300\n1234567";
        assert_eq!(
            check(TextField::InterestMessage, text),
            Err(ContainsContactInfo)
        );
    }

    #[test]
    fn contact_rules_come_before_banned_words() {
        assert_eq!(
            check(TextField::InterestMessage, "hookup 0300 1234567"),
            Err(ContainsContactInfo)
        );
    }

    // ---- Normalisation (13 section 3.2) ----

    #[test]
    fn normalize_applies_the_five_steps() {
        // 1. NFKC: full-width letters and digits, compatibility ligatures, circled digits.
        assert_eq!(normalize("\u{FF21}\u{FF22}\u{FF11}"), "ab1");
        assert_eq!(normalize("\u{FB01}ne"), "fine");
        assert_eq!(normalize("\u{2460}\u{2461}"), "12");
        // 2. Both Arabic-Indic digit ranges.
        assert_eq!(normalize("\u{0660}\u{0669}\u{06F0}\u{06F9}"), "0909");
        // 3. Zero-width characters.
        assert_eq!(
            normalize("w\u{200B}h\u{200C}a\u{200D}t\u{2060}s\u{FEFF}app"),
            "whatsapp"
        );
        // 4. Lowercase.
        assert_eq!(normalize("WhatsApp ID"), "whatsapp id");
        // 5. Whitespace, line breaks included.
        assert_eq!(normalize("  a \n\n\t b\u{00A0}c  "), "a b c");
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn zero_width_characters_do_not_hide_contact_details() {
        assert_eq!(
            check(TextField::InterestMessage, "0300\u{200B}1234\u{200D}567"),
            Err(ContainsContactInfo)
        );
        assert_eq!(
            check(TextField::InterestMessage, "wh\u{200B}atsapp id 1"),
            Err(ContainsContactInfo)
        );
        // A full-width email: "AYESHA@GMAIL.COM".
        let full_width = "\u{FF21}\u{FF39}\u{FF25}\u{FF33}\u{FF28}\u{FF21}\u{FF20}\u{FF27}\u{FF2D}\u{FF21}\u{FF29}\u{FF2C}\u{FF0E}\u{FF23}\u{FF2F}\u{FF2D}";
        assert_eq!(
            check(TextField::InterestMessage, full_width),
            Err(ContainsContactInfo)
        );
    }

    #[test]
    fn mixed_digit_scripts_are_read_as_one_number() {
        // ASCII, Arabic-Indic, extended Arabic-Indic and full-width digits in one number.
        let mixed = "03\u{0660}\u{0661}\u{06F2}\u{06F3}\u{FF14}\u{FF15}6";
        assert_eq!(
            check(TextField::InterestMessage, mixed),
            Err(ContainsContactInfo)
        );
    }

    #[test]
    fn suggestion_key_lowercases_and_collapses() {
        assert_eq!(suggestion_key("  Rajput \n  Bhatti "), "rajput bhatti");
        assert_eq!(suggestion_key(""), "");
    }

    #[test]
    fn tidy_multiline_keeps_paragraphs() {
        assert_eq!(
            tidy_multiline("  a  b \r\n\r\n\r\n\r\n c\t d  \r\n"),
            "a b\n\nc d"
        );
        assert_eq!(
            tidy_multiline("a\rb\u{2028}c\u{0085}d\u{2029}e"),
            "a\nb\nc\nd\ne"
        );
        assert_eq!(tidy_multiline("\n\n  \n"), "");
        assert_eq!(tidy_multiline("one\ntwo"), "one\ntwo");
        assert_eq!(tidy_multiline("one\n \n \ntwo"), "one\n\ntwo");
    }

    #[test]
    fn tidy_line_removes_all_line_breaks() {
        assert_eq!(tidy_line("a\nb\r\nc"), "a b c");
        assert_eq!(tidy_line("\u{00A0}x\u{3000}y\u{00A0}"), "x y");
    }

    // ---- Exemptions and the word rule (13 section 3.4) ----

    #[test]
    fn year_ranges_and_dates_are_exempt() {
        assert_eq!(about_me("MBA 2018-2020"), Ok(()));
        assert_eq!(about_me("MBA 2018 to 2020"), Ok(()));
        assert_eq!(
            about_me("worked 2010 till 2015 and 2015 until 2019"),
            Ok(())
        );
        assert_eq!(about_me("born 1/2/98"), Ok(()));
        assert_eq!(about_me("born 01.02.1998"), Ok(()));
        assert_eq!(about_me("born 1/2/1998 in lahore"), Ok(()));
        // The exemptions do not cover a real number next to them.
        assert_eq!(
            about_me("2018-2020 and 0300 1234567"),
            Err(ContainsContactInfo)
        );
    }

    #[test]
    fn spoken_numbers_need_enough_tokens_words_and_digits() {
        let hit = |text: &str| has_spoken_phone_number(&normalize(text));
        // Five tokens are too few.
        assert!(!hit("zero three zero zero one"));
        // Six tokens, but only six digits.
        assert!(!hit("zero three zero zero one two"));
        assert!(!hit("one two three four five six"));
        // Two words are enough when the digits are there: 2 words and 4 tokens of 4 digits.
        assert!(hit("zero 1234 5678 1234 1234 one"));
        // One word is not.
        assert!(!hit("zero 1234 5678 1234 1234 1234"));
        // A non-number token ends the run.
        assert!(!hit(
            "zero three zero zero one two and three four five six seven"
        ));
        // Triple repeats the digit.
        assert!(hit("zero three triple five triple two three four"));
        assert!(hit("zero three double zero 12 34 567"));
        // A modifier that is not directly before a number token breaks the run.
        assert!(!hit("zero three double and zero 12 34 567"));
        assert!(!hit("zero three double"));
        // A five-digit token is not a number token.
        assert!(!hit("zero three zero zero 12345 12 34 567"));
        // Separators of any kind split tokens.
        assert!(hit(
            "zero,three;zero-zero/one two three four five six seven"
        ));
    }

    #[test]
    fn digit_counting_is_not_fooled_by_ordinary_text() {
        assert_eq!(
            about_me("Height 5 ft 7 in, weight 62 kg, born 1995, salary 150000"),
            Ok(())
        );
        assert_eq!(
            about_me("Phase 5, street 12, house 7, block 3, sector 9"),
            Ok(())
        );
        assert_eq!(
            about_me("one of two sisters, the third of four children"),
            Ok(())
        );
    }

    #[test]
    fn email_and_link_variants() {
        assert_eq!(about_me("ayesha @ gmail . com"), Err(ContainsContactInfo));
        assert_eq!(about_me("ayesha [at] gmail"), Err(ContainsContactInfo));
        assert_eq!(
            about_me("https://example.org/profile"),
            Err(ContainsContactInfo)
        );
        assert_eq!(about_me("HTTP://EXAMPLE.ORG"), Err(ContainsContactInfo));
        assert_eq!(about_me("my page is example.io"), Err(ContainsContactInfo));
        assert_eq!(about_me("gmail dot com"), Err(ContainsContactInfo));
        assert_eq!(about_me("I use gmail and outlook for work"), Ok(()));
        assert_eq!(about_me("looking for a match in the .com era"), Ok(()));
    }

    #[test]
    fn handle_variants() {
        assert_eq!(about_me("find me @ayesha"), Err(ContainsContactInfo));
        assert_eq!(
            about_me("ping me on instagram @ayesha_k"),
            Err(ContainsContactInfo)
        );
        assert_eq!(about_me("snap: ayesha"), Err(ContainsContactInfo));
        assert_eq!(about_me("I do not use tiktok"), Ok(()));
        // A handle needs three characters.
        assert_eq!(about_me("see you @ 5"), Ok(()));
        assert_eq!(about_me("meet @ ab"), Ok(()));
    }

    // ---- Banned words (13 section 3.6) ----

    #[test]
    fn banned_words_match_whole_words_and_phrases_only() {
        let banned = |text: &str| has_banned_word(&normalize(text));
        assert!(banned("looking for a hookup"));
        assert!(banned("Looking for a HOOK UP"));
        assert!(banned("hook   up"));
        assert!(banned("sugar daddy wanted"));
        assert!(banned("Marriage Bureau"));
        assert!(banned("call girl"));
        assert!(banned("fees apply"));
        assert!(banned("contact our office today"));
        // A banned word inside a longer word does not match.
        assert!(!banned("the escorted guests"));
        assert!(!banned("a classic shiitake dish"));
        assert!(!banned("hookups"));
        assert!(!banned("marriage bureaucracy"));
        assert!(!banned("timepasses"));
        // Every phrase of the intent and commercial parts of the list is found.
        for phrase in [
            "hookup",
            "hook up",
            "one night stand",
            "friends with benefits",
            "sugar daddy",
            "sugar mommy",
            "sugar baby",
            "escort",
            "call girl",
            "time pass",
            "timepass",
            "casual relationship",
            "no strings attached",
            "girlfriend wanted",
            "boyfriend wanted",
            "marriage bureau",
            "rishta service",
            "rishta center",
            "rishta centre",
            "matchmaking service",
            "fees apply",
            "registration fee",
            "contact our office",
        ] {
            assert!(banned(&format!("hello {phrase} there")), "{phrase}");
        }
    }

    #[test]
    fn banned_words_file_parses() {
        let phrases = banned_phrases(BANNED_WORDS_SOURCE);
        assert!(phrases.len() > 40);
        for phrase in &phrases {
            assert_eq!(phrase, &suggestion_key(phrase));
            assert!(!phrase.starts_with('#'));
        }
        assert!(banned_words_regex("# only a comment\n\n").is_none());
        assert!(!has_banned_word(""));
    }

    #[test]
    fn banned_words_are_found_through_the_whole_pipeline() {
        assert_eq!(
            check(
                TextField::AboutMe,
                &format!("{} timepass only", "x".repeat(60))
            ),
            Err(Inappropriate)
        );
        assert_eq!(check(TextField::JobTitle, "Sugar Baby"), Err(Inappropriate));
        assert_eq!(
            check(TextField::CasteOther, "Rishta Centre"),
            Err(Inappropriate)
        );
    }

    // ---- Public surface ----

    #[test]
    fn every_pattern_compiles() {
        init();
    }

    #[test]
    fn violation_codes_are_the_field_codes_of_the_api_contract() {
        assert_eq!(TooShort.code(), "too_short");
        assert_eq!(TooLong.code(), "too_long");
        assert_eq!(Invalid.code(), "invalid");
        assert_eq!(ContainsContactInfo.code(), "contains_contact_info");
        assert_eq!(Inappropriate.code(), "inappropriate");
        assert_eq!(ContainsContactInfo.to_string(), "contains_contact_info");
    }

    #[test]
    fn violation_messages() {
        assert_eq!(
            ContainsContactInfo.message(TextField::AboutMe),
            "Please remove phone numbers, email addresses, links and social media names. \
             You can share contact details privately once you are connected."
        );
        assert_eq!(
            Inappropriate.message(TextField::AboutMe),
            "Please keep the wording respectful and suitable for a family platform."
        );
        assert_eq!(
            Invalid.message(TextField::FirstName),
            "Use letters only. Numbers and symbols are not allowed in a name."
        );
        assert_eq!(
            TooShort.message(TextField::ManagerName),
            "Enter a name of 2 to 80 characters."
        );
        assert_eq!(
            TooLong.message(TextField::AboutMe),
            "Use at most 1500 characters."
        );
        assert_eq!(
            TooShort.message(TextField::AboutMe),
            "Enter at least 50 characters."
        );
    }

    #[test]
    fn field_names_are_unique_request_keys() {
        let mut names: Vec<&str> = TextField::ALL.iter().map(|f| f.name()).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(names.len(), before);
        assert_eq!(before, 21);
        assert_eq!(TextField::PartnerNotes.name(), "notes");
        assert_eq!(TextField::InterestMessage.name(), "message");
    }

    #[test]
    fn groups_follow_the_spec_table() {
        for field in [
            TextField::FirstName,
            TextField::LastName,
            TextField::ManagerName,
            TextField::GuardianName,
        ] {
            assert_eq!(field.group(), TextGroup::Name);
        }
        for field in [
            TextField::AboutMe,
            TextField::AboutFamily,
            TextField::PartnerNotes,
            TextField::InterestMessage,
        ] {
            assert_eq!(field.group(), TextGroup::LongText);
            assert!(field.is_multiline());
        }
        for field in [
            TextField::JobTitle,
            TextField::EmployerName,
            TextField::InstituteName,
            TextField::DegreeTitle,
            TextField::FatherOccupation,
            TextField::MotherOccupation,
            TextField::Area,
            TextField::CityOther,
            TextField::OriginOther,
            TextField::CasteOther,
            TextField::SubCasteOther,
            TextField::DisabilityDetails,
            TextField::BestTimeToCall,
        ] {
            assert_eq!(field.group(), TextGroup::ShortText);
            assert!(!field.is_multiline());
        }
    }

    #[test]
    fn multiline_fields_keep_line_breaks_in_the_stored_value() {
        let stored = validate(
            TextField::AboutMe,
            "First paragraph here, long enough to pass the minimum length.\r\n\r\n\r\nSecond  paragraph.",
        );
        assert_eq!(
            stored,
            Ok(Some(
                "First paragraph here, long enough to pass the minimum length.\n\nSecond paragraph."
                    .to_owned()
            ))
        );
        // A single-line field turns line breaks into spaces.
        assert_eq!(
            validate(TextField::JobTitle, "Software\nEngineer"),
            Ok(Some("Software Engineer".to_owned()))
        );
    }

    // ---- Odd input: nothing may panic ----

    fn odd_inputs() -> Vec<String> {
        vec![
            String::new(),
            " ".to_owned(),
            "\n\r\t".to_owned(),
            "\u{0}".to_owned(),
            "0".repeat(100_000),
            "0 ".repeat(100_000),
            "a".repeat(1_000_000),
            "\u{1F600}".repeat(5_000),
            "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}".repeat(2_000),
            "e\u{0301}".repeat(10_000),
            "\u{0639}\u{0627}\u{0626}\u{0634}\u{06C1} \u{062E}\u{0627}\u{0646}".repeat(500),
            "\u{06F0}\u{06F3}\u{06F0}\u{06F0}\u{0661}\u{0662}\u{0663}\u{FF14}5\u{0666}7".to_owned(),
            "\u{FDFA}".repeat(2_000),
            "@".repeat(10_000),
            "@a@a@a@a".repeat(2_000),
            ".".repeat(10_000),
            "insta".repeat(5_000),
            "double ".repeat(5_000),
            "zero ".repeat(5_000),
            "\u{202E}rtl override\u{202C}".to_owned(),
            "\u{FFFD}\u{FFFF}\u{10FFFF}".to_owned(),
            "I\u{0307}STANBUL \u{03A3}".to_owned(),
        ]
    }

    #[test]
    fn odd_input_never_panics() {
        for input in odd_inputs() {
            let _ = normalize(&input);
            let _ = tidy_line(&input);
            let _ = tidy_multiline(&input);
            let _ = suggestion_key(&input);
            let clipped: String = input.chars().take(5_000).collect();
            for field in TextField::ALL {
                let _ = validate(*field, &input);
                let _ = check(*field, &input);
                // The content rules directly, past the length limits that normally guard them.
                let _ = check_content(*field, &field.tidy(&clipped));
            }
        }
    }

    #[test]
    fn huge_input_is_refused_on_length_before_the_patterns_run() {
        let huge = "0".repeat(2_000_000);
        for field in TextField::ALL {
            assert_eq!(check(*field, &huge), Err(TooLong), "{field:?}");
        }
    }
}
