//! Identity document numbers: normalisation, validation, masking and the hash namespace
//! (12 sections 2 and 3, 20 section 2.1, 04 section 5.4).
//!
//! This module is pure. Encryption (AES-256-GCM) and the keyed hash (HMAC-SHA256) live in
//! `services/crypto.rs`; this module only prepares what they take: the normalised number
//! ([`IdentityNumber::as_str`]) and the exact string to hash ([`IdentityNumber::hash_input`],
//! `<namespace>:<normalised number>`).
//!
//! A handler calls [`IdentityNumber::parse`] with the document type, the number as typed and the
//! profile's gender, and gets either a validated number or the first rule it broke.
//!
//! The type holding the plain number follows 12 section 2.3: it implements neither `Debug` nor
//! `Serialize` (nor `Clone`), and its memory is zeroed on drop.

use std::fmt;

use zeroize::Zeroizing;

use crate::domain::options::{DocumentType, Gender};

/// How many asterisks start the mask. A CNIC, NICOP or POC number has 13 characters, so the mask
/// of 12 section 2.3 (`*********1234`) is nine asterisks and the last four digits.
const MASK_LENGTH: usize = 9;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/// The first rule of 12 section 3.3 that a number broke.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityError {
    /// Rule 1, field code `required`: nothing is left after normalisation.
    Required,
    /// Rule 2, field code `invalid`: a CNIC, NICOP or POC number is not exactly 13 digits.
    NotThirteenDigits,
    /// Rules 3 and 4, field code `invalid`: the first digit is not 1 to 8, or the number is
    /// thirteen identical digits or `1234567890123`.
    ImplausibleCnic,
    /// Rule 5, field code `mismatch`: the last digit disagrees with the profile's gender.
    GenderMismatch,
    /// Rule 6, field code `invalid`: not 6 to 12 letters and digits with at least one digit.
    BadPassport,
    /// Rule 5 needs `profiles.gender` and it is not set. This is not a field error: it is
    /// `409 invalid_state` (12 section 3.3, notes; 15 section 7).
    GenderUnknown,
}

impl IdentityError {
    /// The field error code of 15 section 2.2 for `validation_failed` on the field `number`, or
    /// `None` for [`IdentityError::GenderUnknown`], which is `409 invalid_state` instead.
    pub const fn field_code(self) -> Option<&'static str> {
        match self {
            Self::Required => Some("required"),
            Self::NotThirteenDigits | Self::ImplausibleCnic | Self::BadPassport => Some("invalid"),
            Self::GenderMismatch => Some("mismatch"),
            Self::GenderUnknown => None,
        }
    }

    /// The English message of 12 section 3.3. The text for [`IdentityError::GenderUnknown`] is
    /// not in the spec; it is a plain explanation for the `invalid_state` response.
    pub const fn message(self) -> &'static str {
        match self {
            Self::Required => "Enter the number.",
            Self::NotThirteenDigits => "A CNIC number has 13 digits.",
            Self::ImplausibleCnic => "This does not look like a valid CNIC number.",
            Self::GenderMismatch => {
                "This number does not match the gender on the profile. Please check the number and the gender. If both are correct, contact support."
            }
            Self::BadPassport => "A passport number has 6 to 12 letters and digits.",
            Self::GenderUnknown => "Set the gender on the profile before entering this number.",
        }
    }
}

impl fmt::Display for IdentityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for IdentityError {}

// ---------------------------------------------------------------------------------------------
// Normalisation and validation
// ---------------------------------------------------------------------------------------------

/// Normalises a number as typed (12 section 3.2): remove every space and every hyphen, convert
/// to upper case. (Trimming is covered: all whitespace is removed, not only the ends.)
///
/// `35202-1234567-1`, `35202 1234567 1` and `3520212345671` all give `3520212345671`.
///
/// Only the ASCII hyphen is removed, as the spec says. Digits in other scripts are not converted,
/// so they fail the digit rules.
pub fn normalize(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_uppercase()
}

/// Whether the text is exactly 13 characters, all ASCII digits (rule 2).
fn is_thirteen_digits(number: &str) -> bool {
    number.len() == 13 && number.bytes().all(|b| b.is_ascii_digit())
}

/// Rules 3 to 5 for CNIC and NICOP, on a text that is known to be 13 ASCII digits.
fn check_cnic_shape(number: &str, gender: Option<Gender>) -> Result<(), IdentityError> {
    let (Some(&first), Some(&last)) = (number.as_bytes().first(), number.as_bytes().last()) else {
        return Err(IdentityError::NotThirteenDigits);
    };
    // Rule 3: the first digit is the province of issue, 1 to 8.
    if !(b'1'..=b'8').contains(&first) {
        return Err(IdentityError::ImplausibleCnic);
    }
    // Rule 4: not thirteen identical digits and not the obvious sequence.
    if number.bytes().all(|b| b == first) || number == "1234567890123" {
        return Err(IdentityError::ImplausibleCnic);
    }
    // Rule 5: odd last digit for male, even (including 0) for female.
    let Some(gender) = gender else {
        return Err(IdentityError::GenderUnknown);
    };
    let last_is_odd = (last - b'0') % 2 == 1;
    match (gender, last_is_odd) {
        (Gender::Male, true) | (Gender::Female, false) => Ok(()),
        (Gender::Male, false) | (Gender::Female, true) => Err(IdentityError::GenderMismatch),
    }
}

/// Rule 6: 6 to 12 characters, each `A-Z` or `0-9`, at least one digit.
fn check_passport(number: &str) -> Result<(), IdentityError> {
    let characters_ok = number
        .bytes()
        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    let has_digit = number.bytes().any(|b| b.is_ascii_digit());
    if (6..=12).contains(&number.len()) && characters_ok && has_digit {
        Ok(())
    } else {
        Err(IdentityError::BadPassport)
    }
}

/// Validates an already [`normalize`]d number against the rules of 12 section 3.3, in order. The
/// first failure is returned.
///
/// | # | Applies to | Rule |
/// |---|---|---|
/// | 1 | all | not empty |
/// | 2 | `cnic`, `nicop`, `poc` | exactly 13 digits |
/// | 3 | `cnic`, `nicop` | first digit 1 to 8 |
/// | 4 | `cnic`, `nicop` | not thirteen identical digits, not `1234567890123` |
/// | 5 | `cnic`, `nicop` | last digit odd for male, even for female |
/// | 6 | `passport` | 6 to 12 of `A-Z` or `0-9`, at least one digit |
///
/// `gender` is `profiles.gender`; it is only looked at by rule 5, and `None` there gives
/// [`IdentityError::GenderUnknown`]. `poc` has no gender rule.
///
/// # Errors
///
/// The first rule the number breaks.
pub fn validate(
    document_type: DocumentType,
    normalized: &str,
    gender: Option<Gender>,
) -> Result<(), IdentityError> {
    if normalized.is_empty() {
        return Err(IdentityError::Required);
    }
    match document_type {
        DocumentType::Cnic | DocumentType::Nicop => {
            if is_thirteen_digits(normalized) {
                check_cnic_shape(normalized, gender)
            } else {
                Err(IdentityError::NotThirteenDigits)
            }
        }
        DocumentType::Poc => {
            if is_thirteen_digits(normalized) {
                Ok(())
            } else {
                Err(IdentityError::NotThirteenDigits)
            }
        }
        DocumentType::Passport => check_passport(normalized),
    }
}

// ---------------------------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------------------------

/// The last four characters of a normalised number: `profile_identity.number_last4`
/// (12 section 3.5). Shorter input is returned whole; a validated number always has at least six
/// characters.
pub fn last4(normalized: &str) -> String {
    let count = normalized.chars().count();
    normalized.chars().skip(count.saturating_sub(4)).collect()
}

/// The masked display of `IdentitySummary.number_masked` (12 section 2.3, 15 section 4.3): nine
/// asterisks and the last four characters, for example `*********1234`.
///
/// The mask is built from `number_last4` alone, because that is all the database keeps and the
/// number is never decrypted for display. A CNIC, NICOP or POC number has 13 characters, so nine
/// asterisks stand for every character but the last four. A passport number has 6 to 12
/// characters and its length is not stored, so it gets the same fixed nine asterisks.
pub fn mask(last4: &str) -> String {
    format!("{}{last4}", "*".repeat(MASK_LENGTH))
}

/// The namespace that keeps the hash of one kind of identifier apart from another (12 section
/// 3.4). A person's NICOP carries the same 13 digits as their CNIC, so the two share `pk_id`, and
/// one person cannot hold a profile under each. The `email` and `phone` namespaces of
/// `banned_identities` (20 section 2.1) belong to the crypto service.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HashNamespace {
    /// `pk_id`: CNIC and NICOP.
    PkId,
    /// `poc`.
    Poc,
    /// `passport`.
    Passport,
}

impl HashNamespace {
    /// The text put before the colon.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PkId => "pk_id",
            Self::Poc => "poc",
            Self::Passport => "passport",
        }
    }

    /// The namespace of a document type: `pk_id` for `cnic` and `nicop`, `poc` for `poc`,
    /// `passport` for `passport`.
    pub const fn of(document_type: DocumentType) -> Self {
        match document_type {
            DocumentType::Cnic | DocumentType::Nicop => Self::PkId,
            DocumentType::Poc => Self::Poc,
            DocumentType::Passport => Self::Passport,
        }
    }
}

/// The exact string that is hashed: `<namespace>:<normalised number>` (12 section 3.4, 20 section
/// 2.1). The caller computes `HMAC-SHA256(IDENTITY_HASH_PEPPER, hash_input)` over its UTF-8 bytes.
/// The same string, hashed the same way, is what goes into `banned_identities` for a banned
/// person.
///
/// The result holds the plain number, so it is zeroed on drop.
pub fn hash_input(document_type: DocumentType, normalized: &str) -> Zeroizing<String> {
    Zeroizing::new(format!(
        "{}:{normalized}",
        HashNamespace::of(document_type).as_str()
    ))
}

// ---------------------------------------------------------------------------------------------
// A validated number
// ---------------------------------------------------------------------------------------------

/// A normalised, validated identity number.
///
/// Deliberately has no `Debug`, `Clone` or `Serialize` (12 section 2.3), so it cannot end up in a
/// log line, an error report or a response by accident. The number is zeroed when the value is
/// dropped.
pub struct IdentityNumber {
    document_type: DocumentType,
    value: Zeroizing<String>,
}

impl IdentityNumber {
    /// Normalises `raw` and validates it for `document_type` (12 sections 3.2 and 3.3).
    ///
    /// `gender` is `profiles.gender`, needed by the gender rule of CNIC and NICOP.
    ///
    /// # Errors
    ///
    /// The first rule the number breaks (see [`validate`]).
    pub fn parse(
        document_type: DocumentType,
        raw: &str,
        gender: Option<Gender>,
    ) -> Result<Self, IdentityError> {
        let value = Zeroizing::new(normalize(raw));
        validate(document_type, &value, gender)?;
        Ok(Self {
            document_type,
            value,
        })
    }

    /// The document type it was validated for.
    pub const fn document_type(&self) -> DocumentType {
        self.document_type
    }

    /// The normalised number, the plain text that `number_encrypted` encrypts (20 section 2.1).
    pub fn as_str(&self) -> &str {
        &self.value
    }

    /// The hash namespace of the document type.
    pub const fn namespace(&self) -> HashNamespace {
        HashNamespace::of(self.document_type)
    }

    /// The string to hash, `<namespace>:<normalised number>` (see [`hash_input`]).
    pub fn hash_input(&self) -> Zeroizing<String> {
        hash_input(self.document_type, &self.value)
    }

    /// `number_last4`: the last four characters.
    pub fn last4(&self) -> String {
        last4(&self.value)
    }

    /// `IdentitySummary.number_masked`, for example `*********1234` (see [`mask`]).
    pub fn masked(&self) -> String {
        mask(&self.last4())
    }
}

#[cfg(test)]
mod tests {
    use std::fmt::Debug;

    use super::*;

    const MALE_CNIC: &str = "3520212345671";
    const FEMALE_CNIC: &str = "3520212345672";

    fn check(
        document_type: DocumentType,
        raw: &str,
        gender: Option<Gender>,
    ) -> Result<(), IdentityError> {
        IdentityNumber::parse(document_type, raw, gender).map(|_| ())
    }

    fn cnic(raw: &str, gender: Gender) -> Result<(), IdentityError> {
        check(DocumentType::Cnic, raw, Some(gender))
    }

    // ---- Normalisation (12 section 3.2) ----

    #[test]
    fn the_three_spec_spellings_normalise_to_the_same_number() {
        assert_eq!(normalize("35202-1234567-1"), "3520212345671");
        assert_eq!(normalize("35202 1234567 1"), "3520212345671");
        assert_eq!(normalize("3520212345671"), "3520212345671");
    }

    #[test]
    fn normalisation_trims_removes_spaces_and_hyphens_and_uppercases() {
        assert_eq!(normalize("  35202-1234567-1  "), "3520212345671");
        assert_eq!(normalize("\t35202\n1234567 - 1 "), "3520212345671");
        assert_eq!(normalize("35202\u{00A0}1234567\u{00A0}1"), "3520212345671");
        assert_eq!(normalize("ab-12 34 56"), "AB123456");
        assert_eq!(normalize("ab12cd34"), "AB12CD34");
        assert_eq!(normalize(""), "");
        assert_eq!(normalize(" - - "), "");
    }

    // ---- Rule 1: required ----

    #[test]
    fn an_empty_number_is_required_for_every_type() {
        for document_type in DocumentType::ALL {
            for raw in ["", "   ", "- -", "\n"] {
                assert_eq!(
                    check(*document_type, raw, Some(Gender::Male)),
                    Err(IdentityError::Required),
                    "{document_type} {raw:?}"
                );
            }
        }
    }

    // ---- Rule 2: thirteen digits ----

    #[test]
    fn cnic_nicop_and_poc_need_exactly_thirteen_digits() {
        for document_type in [DocumentType::Cnic, DocumentType::Nicop, DocumentType::Poc] {
            for raw in [
                "352021234567",
                "35202123456711",
                "352021234567A",
                "A520212345671",
                "35202.1234567.1",
                "3520212345 671!",
                "35202_12345671",
                // Digits of other scripts are not converted.
                "\u{06F3}\u{06F5}\u{06F2}\u{06F0}\u{06F2}\u{06F1}\u{06F2}\u{06F3}\u{06F4}\u{06F5}\u{06F6}\u{06F7}\u{06F1}",
                "\u{0663}\u{0665}\u{0662}\u{0660}\u{0662}\u{0661}\u{0662}\u{0663}\u{0664}\u{0665}\u{0666}\u{0667}\u{0661}",
                "\u{FF13}\u{FF15}\u{FF12}\u{FF10}\u{FF12}\u{FF11}\u{FF12}\u{FF13}\u{FF14}\u{FF15}\u{FF16}\u{FF17}\u{FF11}",
            ] {
                assert_eq!(
                    check(document_type, raw, Some(Gender::Male)),
                    Err(IdentityError::NotThirteenDigits),
                    "{document_type} {raw:?}"
                );
            }
        }
    }

    // ---- Rule 3: first digit ----

    #[test]
    fn the_first_digit_of_a_cnic_is_one_to_eight() {
        for first in '1'..='8' {
            let number = format!("{first}520212345671");
            assert_eq!(cnic(&number, Gender::Male), Ok(()), "{number}");
        }
        for first in ['0', '9'] {
            let number = format!("{first}520212345671");
            assert_eq!(
                cnic(&number, Gender::Male),
                Err(IdentityError::ImplausibleCnic),
                "{number}"
            );
            assert_eq!(
                check(DocumentType::Nicop, &number, Some(Gender::Male)),
                Err(IdentityError::ImplausibleCnic),
                "{number}"
            );
        }
    }

    #[test]
    fn poc_accepts_any_first_digit() {
        assert_eq!(check(DocumentType::Poc, "0123456789012", None), Ok(()));
        assert_eq!(check(DocumentType::Poc, "9123456789012", None), Ok(()));
        assert_eq!(check(DocumentType::Poc, "0000000000000", None), Ok(()));
    }

    // ---- Rule 4: obvious fakes ----

    #[test]
    fn thirteen_identical_digits_and_the_sequence_are_refused() {
        for digit in '1'..='8' {
            let number: String = std::iter::repeat_n(digit, 13).collect();
            assert_eq!(
                cnic(&number, Gender::Male),
                Err(IdentityError::ImplausibleCnic),
                "{number}"
            );
            assert_eq!(
                cnic(&number, Gender::Female),
                Err(IdentityError::ImplausibleCnic),
                "{number}"
            );
        }
        assert_eq!(
            cnic("1234567890123", Gender::Male),
            Err(IdentityError::ImplausibleCnic)
        );
        assert_eq!(
            cnic("1234567890123", Gender::Female),
            Err(IdentityError::ImplausibleCnic)
        );
        // One digit different is fine.
        assert_eq!(cnic("1111111111113", Gender::Male), Ok(()));
        assert_eq!(cnic("1234567890124", Gender::Female), Ok(()));
    }

    // ---- Rule 5: gender ----

    #[test]
    fn the_last_digit_must_agree_with_the_gender() {
        assert_eq!(cnic(MALE_CNIC, Gender::Male), Ok(()));
        assert_eq!(cnic(FEMALE_CNIC, Gender::Female), Ok(()));
        assert_eq!(
            cnic(MALE_CNIC, Gender::Female),
            Err(IdentityError::GenderMismatch)
        );
        assert_eq!(
            cnic(FEMALE_CNIC, Gender::Male),
            Err(IdentityError::GenderMismatch)
        );
        for last in ['1', '3', '5', '7', '9'] {
            let number = format!("352021234567{last}");
            assert_eq!(cnic(&number, Gender::Male), Ok(()), "{number}");
            assert_eq!(
                cnic(&number, Gender::Female),
                Err(IdentityError::GenderMismatch),
                "{number}"
            );
        }
        // Even, including 0, is female.
        for last in ['0', '2', '4', '6', '8'] {
            let number = format!("352021234567{last}");
            assert_eq!(cnic(&number, Gender::Female), Ok(()), "{number}");
            assert_eq!(
                cnic(&number, Gender::Male),
                Err(IdentityError::GenderMismatch),
                "{number}"
            );
        }
    }

    #[test]
    fn nicop_follows_the_same_gender_rule() {
        assert_eq!(
            check(DocumentType::Nicop, MALE_CNIC, Some(Gender::Male)),
            Ok(())
        );
        assert_eq!(
            check(DocumentType::Nicop, MALE_CNIC, Some(Gender::Female)),
            Err(IdentityError::GenderMismatch)
        );
    }

    #[test]
    fn poc_and_passport_have_no_gender_rule() {
        for gender in [None, Some(Gender::Male), Some(Gender::Female)] {
            assert_eq!(check(DocumentType::Poc, "1234567890124", gender), Ok(()));
            assert_eq!(check(DocumentType::Poc, "1234567890123", gender), Ok(()));
            assert_eq!(check(DocumentType::Passport, "AB1234567", gender), Ok(()));
        }
    }

    #[test]
    fn an_unknown_gender_is_reported_only_when_rule_five_is_reached() {
        // A well-formed CNIC with no gender: invalid_state, not a field error.
        let error = check(DocumentType::Cnic, MALE_CNIC, None).expect_err("needs a gender");
        assert_eq!(error, IdentityError::GenderUnknown);
        assert_eq!(error.field_code(), None);
        assert_eq!(
            check(DocumentType::Nicop, FEMALE_CNIC, None),
            Err(IdentityError::GenderUnknown)
        );
        // Earlier rules win, with or without a gender.
        assert_eq!(
            check(DocumentType::Cnic, "", None),
            Err(IdentityError::Required)
        );
        assert_eq!(
            check(DocumentType::Cnic, "123", None),
            Err(IdentityError::NotThirteenDigits)
        );
        assert_eq!(
            check(DocumentType::Cnic, "0520212345671", None),
            Err(IdentityError::ImplausibleCnic)
        );
        assert_eq!(
            check(DocumentType::Cnic, "1111111111111", None),
            Err(IdentityError::ImplausibleCnic)
        );
    }

    // ---- Rule 6: passport ----

    #[test]
    fn passport_numbers_are_six_to_twelve_letters_and_digits_with_a_digit() {
        let passport = |raw: &str| check(DocumentType::Passport, raw, None);
        assert_eq!(passport("AB1234"), Ok(()));
        assert_eq!(passport("AB123456"), Ok(()));
        assert_eq!(passport("ab-12 34 56"), Ok(()));
        assert_eq!(passport("A1B2C3D4E5F6"), Ok(()));
        assert_eq!(passport("123456"), Ok(()));
        // Length.
        assert_eq!(passport("AB123"), Err(IdentityError::BadPassport));
        assert_eq!(passport("A1B2C3D4E5F6G"), Err(IdentityError::BadPassport));
        // At least one digit.
        assert_eq!(passport("ABCDEFGH"), Err(IdentityError::BadPassport));
        // Characters.
        assert_eq!(passport("AB12345!"), Err(IdentityError::BadPassport));
        assert_eq!(passport("AB_12345"), Err(IdentityError::BadPassport));
        assert_eq!(passport("AB12345."), Err(IdentityError::BadPassport));
        assert_eq!(
            passport("\u{0627}\u{0628}123456"),
            Err(IdentityError::BadPassport)
        );
        assert_eq!(passport("AB\u{00C9}12345"), Err(IdentityError::BadPassport));
    }

    // ---- Hash namespace and input (12 section 3.4) ----

    #[test]
    fn cnic_and_nicop_with_the_same_digits_have_the_same_hash_input() {
        let cnic = hash_input(DocumentType::Cnic, MALE_CNIC);
        let nicop = hash_input(DocumentType::Nicop, MALE_CNIC);
        assert_eq!(cnic.as_str(), "pk_id:3520212345671");
        assert_eq!(nicop.as_str(), cnic.as_str());
        assert_eq!(HashNamespace::of(DocumentType::Cnic), HashNamespace::PkId);
        assert_eq!(HashNamespace::of(DocumentType::Nicop), HashNamespace::PkId);
    }

    #[test]
    fn poc_and_passport_are_in_their_own_namespaces() {
        assert_eq!(
            hash_input(DocumentType::Poc, "3520212345671").as_str(),
            "poc:3520212345671"
        );
        assert_eq!(
            hash_input(DocumentType::Passport, "AB1234567").as_str(),
            "passport:AB1234567"
        );
        // The same digits under another namespace never collide with `pk_id`.
        assert_ne!(
            hash_input(DocumentType::Poc, MALE_CNIC).as_str(),
            hash_input(DocumentType::Cnic, MALE_CNIC).as_str()
        );
        assert_eq!(HashNamespace::PkId.as_str(), "pk_id");
        assert_eq!(HashNamespace::Poc.as_str(), "poc");
        assert_eq!(HashNamespace::Passport.as_str(), "passport");
    }

    #[test]
    fn parsed_numbers_collide_across_cnic_and_nicop_whatever_the_spelling() {
        let a = IdentityNumber::parse(DocumentType::Cnic, "35202-1234567-1", Some(Gender::Male))
            .expect("valid");
        let b = IdentityNumber::parse(DocumentType::Nicop, " 35202 1234567 1 ", Some(Gender::Male))
            .expect("valid");
        assert_eq!(a.hash_input().as_str(), b.hash_input().as_str());
        assert_eq!(a.hash_input().as_str(), "pk_id:3520212345671");
        assert_eq!(a.namespace(), b.namespace());
        assert_eq!(a.as_str(), b.as_str());
        assert_eq!(a.document_type(), DocumentType::Cnic);
        assert_eq!(b.document_type(), DocumentType::Nicop);
    }

    // ---- last4 and mask (12 sections 2.3 and 3.5) ----

    #[test]
    fn last4_and_mask() {
        let number =
            IdentityNumber::parse(DocumentType::Cnic, "35202-1234567-1", Some(Gender::Male))
                .expect("valid");
        assert_eq!(number.last4(), "5671");
        assert_eq!(number.masked(), "*********5671");
        assert_eq!(mask("1234"), "*********1234");
        assert_eq!(last4("3520212345671"), "5671");
        assert_eq!(last4("AB123456"), "3456");
        assert_eq!(last4("123"), "123");
        assert_eq!(last4(""), "");
        // `number_last4` must be exactly four characters for a validated number.
        for (document_type, raw) in [
            (DocumentType::Poc, "0123456789012"),
            (DocumentType::Passport, "AB1234"),
            (DocumentType::Passport, "A1B2C3D4E5F6"),
        ] {
            let parsed = IdentityNumber::parse(document_type, raw, None).expect("valid");
            assert_eq!(parsed.last4().chars().count(), 4, "{raw}");
        }
    }

    #[test]
    fn the_masked_number_for_a_passport_uses_the_same_fixed_mask() {
        let passport =
            IdentityNumber::parse(DocumentType::Passport, "ab 1234567", None).expect("valid");
        assert_eq!(passport.as_str(), "AB1234567");
        assert_eq!(passport.last4(), "4567");
        assert_eq!(passport.masked(), "*********4567");
    }

    // ---- Messages and codes (12 section 3.3) ----

    #[test]
    fn field_codes_and_messages_follow_the_spec() {
        assert_eq!(IdentityError::Required.field_code(), Some("required"));
        assert_eq!(IdentityError::Required.message(), "Enter the number.");
        assert_eq!(
            IdentityError::NotThirteenDigits.field_code(),
            Some("invalid")
        );
        assert_eq!(
            IdentityError::NotThirteenDigits.message(),
            "A CNIC number has 13 digits."
        );
        assert_eq!(IdentityError::ImplausibleCnic.field_code(), Some("invalid"));
        assert_eq!(
            IdentityError::ImplausibleCnic.message(),
            "This does not look like a valid CNIC number."
        );
        assert_eq!(IdentityError::GenderMismatch.field_code(), Some("mismatch"));
        assert_eq!(
            IdentityError::GenderMismatch.message(),
            "This number does not match the gender on the profile. Please check the number and the gender. If both are correct, contact support."
        );
        assert_eq!(IdentityError::BadPassport.field_code(), Some("invalid"));
        assert_eq!(
            IdentityError::BadPassport.message(),
            "A passport number has 6 to 12 letters and digits."
        );
        assert_eq!(IdentityError::GenderUnknown.field_code(), None);
        assert_eq!(
            IdentityError::Required.to_string(),
            IdentityError::Required.message()
        );
    }

    // ---- 12 section 2.3: no Debug, no Serialize ----

    /// A compile-time check that a type does not implement a trait: if `T` implemented `Trait`,
    /// the two blanket impls would both apply and `some_item` would be ambiguous.
    trait AmbiguousIfDebug<A> {
        fn some_item() {}
    }
    impl<T: ?Sized> AmbiguousIfDebug<()> for T {}
    impl<T: ?Sized + Debug> AmbiguousIfDebug<u8> for T {}

    trait AmbiguousIfSerialize<A> {
        fn some_item() {}
    }
    impl<T: ?Sized> AmbiguousIfSerialize<()> for T {}
    impl<T: ?Sized + serde::Serialize> AmbiguousIfSerialize<u8> for T {}

    #[test]
    fn the_plain_number_type_has_no_debug_and_no_serialize() {
        <IdentityNumber as AmbiguousIfDebug<_>>::some_item();
        <IdentityNumber as AmbiguousIfSerialize<_>>::some_item();
    }

    // ---- Odd input: nothing may panic ----

    #[test]
    fn odd_input_never_panics() {
        let inputs = [
            String::new(),
            " ".to_owned(),
            "\0".to_owned(),
            "0".repeat(1_000_000),
            "-".repeat(100_000),
            "\u{1F600}".repeat(10_000),
            "\u{0639}\u{0627}\u{0626}\u{0634}\u{06C1}".repeat(1_000),
            "\u{06F0}\u{06F3}\u{06F0}\u{0660}\u{0661}\u{FF11}".repeat(500),
            "\u{00DF}".repeat(1_000),
            "\u{FB01}\u{FB03}".repeat(1_000),
            "\u{017F}\u{0131}12345678901".to_owned(),
            "1".repeat(13),
            "1".repeat(14),
            "\u{202E}3520212345671".to_owned(),
        ];
        for input in &inputs {
            let normalized = normalize(input);
            let _ = last4(&normalized);
            for document_type in DocumentType::ALL {
                for gender in [None, Some(Gender::Male), Some(Gender::Female)] {
                    let _ = validate(*document_type, &normalized, gender);
                    let _ = IdentityNumber::parse(*document_type, input, gender);
                }
            }
        }
    }
}
