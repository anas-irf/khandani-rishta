//! Encryption and keyed hashes for identity numbers, emails and phones (20 section 2.1).
//!
//! - Identity numbers: AES-256-GCM with a random 12-byte nonce and the 16 bytes of the
//!   `profile_id` as associated data, stored as `nonce || ciphertext || tag`.
//! - Hashes: HMAC-SHA256 with the pepper over `<namespace>:<normalised value>`.
//!
//! Nothing here logs its inputs.

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use hmac::{Hmac, Mac};
use rand::Rng;
use sha2::Sha256;
use uuid::Uuid;

use crate::config::IdentityKeys;

const NONCE_LEN: usize = 12;

/// Decryption failed with every configured key: the value was tampered with, belongs to another
/// row, or was written with a key that is no longer configured.
#[derive(Debug, thiserror::Error)]
#[error("the identity number could not be decrypted")]
pub struct DecryptError;

/// Holds the keys. `Debug` is not derived on purpose.
#[derive(Clone)]
pub struct Crypto {
    current: Aes256Gcm,
    previous: Option<Aes256Gcm>,
    pepper: [u8; 32],
}

impl Crypto {
    pub fn new(keys: &IdentityKeys) -> Self {
        Self {
            current: cipher(&keys.encryption_key),
            previous: keys.encryption_key_previous.as_ref().map(cipher),
            pepper: keys.hash_pepper,
        }
    }

    /// Encrypts a normalised identity number for one profile.
    pub fn encrypt_identity(&self, profile_id: Uuid, number: &str) -> Vec<u8> {
        let mut nonce = [0_u8; NONCE_LEN];
        rand::rng().fill_bytes(&mut nonce);
        let sealed = self
            .current
            .encrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: number.as_bytes(),
                    aad: profile_id.as_bytes(),
                },
            )
            .unwrap_or_default();
        let mut stored = Vec::with_capacity(NONCE_LEN + sealed.len());
        stored.extend_from_slice(&nonce);
        stored.extend_from_slice(&sealed);
        stored
    }

    /// Decrypts a stored identity number, trying the current key and then the previous one.
    pub fn decrypt_identity(
        &self,
        profile_id: Uuid,
        stored: &[u8],
    ) -> Result<String, DecryptError> {
        if stored.len() <= NONCE_LEN {
            return Err(DecryptError);
        }
        let (nonce, sealed) = stored.split_at(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = nonce.try_into().map_err(|_| DecryptError)?;
        let nonce = Nonce::from(nonce);
        let payload = || Payload {
            msg: sealed,
            aad: profile_id.as_bytes(),
        };
        let plain = self
            .current
            .decrypt(&nonce, payload())
            .or_else(|_| match &self.previous {
                Some(previous) => previous.decrypt(&nonce, payload()),
                None => Err(aes_gcm::Error),
            })
            .map_err(|_| DecryptError)?;
        String::from_utf8(plain).map_err(|_| DecryptError)
    }

    /// `HMAC-SHA256(pepper, "<namespace>:<value>")`.
    pub fn keyed_hash(&self, namespace: &str, value: &str) -> Vec<u8> {
        let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&self.pepper)
            .expect("HMAC accepts keys of any length");
        mac.update(namespace.as_bytes());
        mac.update(b":");
        mac.update(value.as_bytes());
        mac.finalize().into_bytes().to_vec()
    }

    /// The ban-list hash of an email address (06 section 5.2): lower-cased and trimmed.
    pub fn email_hash(&self, email: &str) -> Vec<u8> {
        self.keyed_hash("email", &email.trim().to_lowercase())
    }

    /// The ban-list hash of an E.164 phone number.
    pub fn phone_hash(&self, phone_e164: &str) -> Vec<u8> {
        self.keyed_hash("phone", phone_e164.trim())
    }
}

fn cipher(key: &[u8; 32]) -> Aes256Gcm {
    Aes256Gcm::new_from_slice(key).expect("the key is 32 bytes")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(previous: Option<[u8; 32]>) -> IdentityKeys {
        IdentityKeys {
            encryption_key: [7; 32],
            encryption_key_previous: previous,
            hash_pepper: [9; 32],
        }
    }

    #[test]
    fn identity_numbers_round_trip() {
        let crypto = Crypto::new(&keys(None));
        let profile = Uuid::now_v7();
        let stored = crypto.encrypt_identity(profile, "3520212345671");
        assert_eq!(stored.len(), 12 + 13 + 16);
        assert_eq!(
            crypto.decrypt_identity(profile, &stored).unwrap(),
            "3520212345671"
        );
    }

    #[test]
    fn every_encryption_uses_a_new_nonce() {
        let crypto = Crypto::new(&keys(None));
        let profile = Uuid::now_v7();
        assert_ne!(
            crypto.encrypt_identity(profile, "3520212345671"),
            crypto.encrypt_identity(profile, "3520212345671")
        );
    }

    #[test]
    fn ciphertext_is_bound_to_its_profile() {
        let crypto = Crypto::new(&keys(None));
        let stored = crypto.encrypt_identity(Uuid::now_v7(), "3520212345671");
        assert!(crypto.decrypt_identity(Uuid::now_v7(), &stored).is_err());
        assert!(crypto.decrypt_identity(Uuid::now_v7(), &[1, 2, 3]).is_err());
    }

    #[test]
    fn the_previous_key_still_decrypts() {
        let old = Crypto::new(&IdentityKeys {
            encryption_key: [3; 32],
            encryption_key_previous: None,
            hash_pepper: [9; 32],
        });
        let profile = Uuid::now_v7();
        let stored = old.encrypt_identity(profile, "AB1234567");
        let rotated = Crypto::new(&keys(Some([3; 32])));
        assert_eq!(
            rotated.decrypt_identity(profile, &stored).unwrap(),
            "AB1234567"
        );
        assert!(
            Crypto::new(&keys(None))
                .decrypt_identity(profile, &stored)
                .is_err()
        );
    }

    #[test]
    fn hashes_are_namespaced_and_normalised() {
        let crypto = Crypto::new(&keys(None));
        assert_eq!(crypto.keyed_hash("pk_id", "1").len(), 32);
        assert_ne!(
            crypto.keyed_hash("pk_id", "1"),
            crypto.keyed_hash("poc", "1")
        );
        assert_eq!(
            crypto.email_hash(" Ali@Example.com "),
            crypto.email_hash("ali@example.com")
        );
        assert_eq!(
            crypto.email_hash("a@b.c"),
            crypto.keyed_hash("email", "a@b.c")
        );
        assert_eq!(
            crypto.phone_hash("+923001234567"),
            crypto.keyed_hash("phone", "+923001234567")
        );
    }
}
