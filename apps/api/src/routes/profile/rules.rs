//! Helpers shared by the section validators: the collector of field errors with the
//! draft-or-not rule of 15 section 7, reference code checks and text checks.

use crate::domain::text_rules::{self, TextField, TextViolation};
use crate::error::{FieldCode, FieldError, FieldErrors};

/// Collects the field errors of one request.
///
/// While the profile is a `draft`, required fields may be left `null` (the step simply cannot
/// be continued); once it has left `draft`, they can no longer be cleared (15 section 7). A
/// requirement tied to another value of the same body is enforced at once ([`Checker::need`]).
pub struct Checker {
    pub errors: FieldErrors,
    /// The profile is still a `draft`.
    pub draft: bool,
}

impl Checker {
    pub fn new(draft: bool) -> Self {
        Self {
            errors: FieldErrors::new(),
            draft,
        }
    }

    /// Adds an error unless the field already has one.
    pub fn fail(&mut self, field: &str, code: FieldCode) {
        if !self.errors.has(field) {
            self.errors.add(field, code);
        }
    }

    /// Adds an error with its own message unless the field already has one.
    pub fn fail_with(&mut self, field: &str, code: FieldCode, message: &str) {
        if !self.errors.has(field) {
            self.errors
                .push(FieldError::with_message(field, code, message));
        }
    }

    /// A required field: `required` when it is missing and the profile has left `draft`.
    pub fn require(&mut self, field: &str, present: bool) {
        if !present && !self.draft {
            self.fail(field, FieldCode::Required);
        }
    }

    /// A requirement tied to another value of the same body: `required` whatever the status.
    pub fn need(&mut self, field: &str, present: bool) {
        if !present {
            self.fail(field, FieldCode::Required);
        }
    }

    /// Validates and tidies a free text (13 section 3). An empty value is `None`.
    pub fn text(&mut self, field: TextField, raw: Option<&str>) -> Option<String> {
        let raw = raw?;
        match text_rules::validate(field, raw) {
            Ok(stored) => stored,
            Err(violation) => {
                self.fail_with(
                    field.name(),
                    violation_code(violation),
                    &violation.message(field),
                );
                None
            }
        }
    }

    /// Checks a reference code. `active` answers `None` for an unknown code and `Some(is_active)`
    /// otherwise. A retired code is accepted only when it is already stored (05 section 1.4
    /// rule 4: new values must be active).
    pub fn code(
        &mut self,
        field: &str,
        value: Option<&str>,
        stored: &[&str],
        active: impl Fn(&str) -> Option<bool>,
    ) -> Option<String> {
        let code = value?.trim();
        if code.is_empty() {
            return None;
        }
        if code_is_valid(code, stored, &active) {
            Some(code.to_owned())
        } else {
            self.fail(field, FieldCode::UnknownCode);
            None
        }
    }

    /// Checks a list of reference codes: duplicates are removed silently, every code must be
    /// valid, and at most `max` remain (`too_long`).
    pub fn codes(
        &mut self,
        field: &str,
        values: &[String],
        stored: &[&str],
        max: usize,
        active: impl Fn(&str) -> Option<bool>,
    ) -> Vec<String> {
        let mut seen: Vec<String> = Vec::with_capacity(values.len().min(max.saturating_add(1)));
        for value in values {
            let code = value.trim();
            if code.is_empty() || seen.iter().any(|existing| existing == code) {
                continue;
            }
            if !code_is_valid(code, stored, &active) {
                self.fail(field, FieldCode::UnknownCode);
                return Vec::new();
            }
            seen.push(code.to_owned());
        }
        if seen.len() > max {
            self.fail(field, FieldCode::TooLong);
        }
        seen
    }

    pub fn finish(self) -> Result<(), crate::error::ApiError> {
        self.errors.finish()
    }
}

fn code_is_valid(code: &str, stored: &[&str], active: &impl Fn(&str) -> Option<bool>) -> bool {
    match active(code) {
        None => false,
        Some(true) => true,
        Some(false) => stored.contains(&code),
    }
}

/// The field error code of a text violation.
pub fn violation_code(violation: TextViolation) -> FieldCode {
    match violation {
        TextViolation::TooShort => FieldCode::TooShort,
        TextViolation::TooLong => FieldCode::TooLong,
        TextViolation::Invalid => FieldCode::Invalid,
        TextViolation::ContainsContactInfo => FieldCode::ContainsContactInfo,
        TextViolation::Inappropriate => FieldCode::Inappropriate,
    }
}

/// A number from `low` to `high`, or the field code `out_of_range`.
pub fn in_range(value: i16, low: i16, high: i16) -> bool {
    (low..=high).contains(&value)
}

/// Removes duplicates, keeping the first occurrence of each value.
pub fn dedupe<T: PartialEq + Clone>(values: &[T]) -> Vec<T> {
    let mut out: Vec<T> = Vec::with_capacity(values.len());
    for value in values {
        if !out.contains(value) {
            out.push(value.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(code: &str) -> Option<bool> {
        match code {
            "live" => Some(true),
            "retired" => Some(false),
            _ => None,
        }
    }

    #[test]
    fn retired_codes_are_accepted_only_when_already_stored() {
        let mut checker = Checker::new(false);
        assert_eq!(
            checker.code("religion_code", Some("live"), &[], lookup),
            Some("live".to_owned())
        );
        assert_eq!(
            checker.code("religion_code", Some("retired"), &["retired"], lookup),
            Some("retired".to_owned())
        );
        assert!(checker.errors.is_empty());
        assert_eq!(checker.code("a", Some("retired"), &[], lookup), None);
        assert_eq!(checker.code("b", Some("nope"), &["nope"], lookup), None);
        let errors = checker.errors.into_inner();
        assert_eq!(errors.len(), 2);
        assert!(errors.iter().all(|e| e.code == FieldCode::UnknownCode));
    }

    #[test]
    fn code_lists_drop_duplicates_and_enforce_the_maximum() {
        let mut checker = Checker::new(false);
        let values = ["live".to_owned(), "live".to_owned(), " ".to_owned()];
        assert_eq!(
            checker.codes("languages", &values, &[], 6, lookup),
            vec!["live".to_owned()]
        );
        assert!(checker.errors.is_empty());
        checker.codes("languages", &values, &[], 0, lookup);
        assert!(checker.errors.has("languages"));
    }

    #[test]
    fn required_depends_on_the_draft_status() {
        let mut draft = Checker::new(true);
        draft.require("height_cm", false);
        assert!(draft.errors.is_empty());
        draft.need("current_wives_count", false);
        assert!(draft.errors.has("current_wives_count"));

        let mut live = Checker::new(false);
        live.require("height_cm", false);
        assert!(live.errors.has("height_cm"));
    }

    #[test]
    fn dedupe_keeps_the_first_of_each() {
        assert_eq!(dedupe(&[3, 1, 3, 2, 1]), vec![3, 1, 2]);
    }
}
