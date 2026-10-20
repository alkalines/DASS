//! A minimal X.509 validity reader.
//!
//! The backend only needs the leaf certificate's expiry to warn the operator
//! before a deployment breaks. The TLS stack remains the authority on the
//! certificate itself: an expired certificate fails every handshake, and this
//! module never decides whether a certificate is trusted.
//!
//! The reader is deliberately small and conservative. It returns `None` for
//! anything it does not understand, and it never refuses a deployment on its
//! own.

/// A parsed validity window, in Unix seconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Validity {
    pub not_before: i64,
    pub not_after: i64,
}

/// Read the leaf certificate's validity window from DER bytes.
pub fn validity(der: &[u8]) -> Option<Validity> {
    let certificate = der_sequence(der)?;
    // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
    let tbs = der_sequence(certificate.0)?;
    // TBSCertificate ::= SEQUENCE { version?, serialNumber, signature, issuer,
    //                             validity, subject, ... }
    // The validity is the only direct child sequence that holds exactly two
    // time values; the issuer and subject hold attribute sets instead.
    let mut rest = tbs.0;
    while !rest.is_empty() {
        let (tag, content, remainder) = der_element(rest)?;
        rest = remainder;
        if tag != 0x30 {
            continue;
        }
        let Some((not_before, not_after)) = der_two_times(content) else {
            continue;
        };
        return Some(Validity {
            not_before,
            not_after,
        });
    }
    None
}

/// Two consecutive time values: `notBefore` and `notAfter`.
fn der_two_times(content: &[u8]) -> Option<(i64, i64)> {
    let (first_tag, first, rest) = der_element(content)?;
    let (second_tag, second, remainder) = der_element(rest)?;
    if !remainder.is_empty() {
        return None;
    }
    let not_before = der_time(first_tag, first)?;
    let not_after = der_time(second_tag, second)?;
    Some((not_before, not_after))
}

/// UTCTime (0x17) and GeneralizedTime (0x18) as Unix seconds.
fn der_time(tag: u8, content: &[u8]) -> Option<i64> {
    let text = std::str::from_utf8(content).ok()?;
    let digits: Vec<u8> = text.bytes().collect();
    let (year, rest) = match tag {
        0x17 => {
            // YYMMDDHHMMSSZ
            if digits.len() != 13 || digits[12] != b'Z' {
                return None;
            }
            let two = number(&digits[0..2])?;
            // RFC 5280: years 50-99 are 19xx, 00-49 are 20xx.
            let year = if two >= 50 { 1900 + two } else { 2000 + two };
            (year, &digits[2..12])
        }
        0x18 => {
            // YYYYMMDDHHMMSSZ
            if digits.len() != 15 || digits[14] != b'Z' {
                return None;
            }
            (number(&digits[0..4])?, &digits[4..14])
        }
        _ => return None,
    };
    let month = number(&rest[0..2])?;
    let day = number(&rest[2..4])?;
    let hour = number(&rest[4..6])?;
    let minute = number(&rest[6..8])?;
    let second = number(&rest[8..10])?;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
        || year < 1970
    {
        return None;
    }
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

fn number(digits: &[u8]) -> Option<i64> {
    if digits.is_empty() {
        return None;
    }
    let mut value: i64 = 0;
    for digit in digits {
        if !digit.is_ascii_digit() {
            return None;
        }
        value = value * 10 + i64::from(digit - b'0');
    }
    Some(value)
}

/// Days between 1970-01-01 and the given civil date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted = if month <= 2 { year - 1 } else { year };
    let era = if adjusted >= 0 {
        adjusted
    } else {
        adjusted - 399
    } / 400;
    let year_of_era = adjusted - era * 400;
    let shifted = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * shifted + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// One DER element: its tag, its content and the remaining bytes.
fn der_element(input: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (first, rest) = input.split_first()?;
    let tag = *first;
    let mut rest = rest;
    // High-tag-number form is not used by the fields this reader needs.
    if tag & 0x1f == 0x1f {
        return None;
    }
    let (length, remainder) = der_length(rest)?;
    rest = remainder;
    if length > rest.len() {
        return None;
    }
    let (content, remainder) = rest.split_at(length);
    Some((tag, content, remainder))
}

/// A DER sequence's content bytes.
fn der_sequence(input: &[u8]) -> Option<(&[u8], &[u8])> {
    let (tag, content, remainder) = der_element(input)?;
    if tag != 0x30 {
        return None;
    }
    Some((content, remainder))
}

/// A DER length: short form, or long form with up to four length bytes.
fn der_length(input: &[u8]) -> Option<(usize, &[u8])> {
    let (first, rest) = input.split_first()?;
    if first & 0x80 == 0 {
        return Some((usize::from(*first), rest));
    }
    let count = usize::from(first & 0x7f);
    if count == 0 || count > 4 || rest.len() < count {
        return None;
    }
    let (bytes, remainder) = rest.split_at(count);
    let mut length = 0usize;
    for byte in bytes {
        length = length.checked_mul(256)?.checked_add(usize::from(*byte))?;
    }
    Some((length, remainder))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal DER certificate with a UTCTime validity window.
    fn certificate(not_before: &str, not_after: &str) -> Vec<u8> {
        fn time(text: &str) -> Vec<u8> {
            let mut element = vec![0x17, text.len() as u8];
            element.extend_from_slice(text.as_bytes());
            element
        }
        let mut validity_content = time(not_before);
        validity_content.extend(time(not_after));
        let mut validity = vec![0x30, validity_content.len() as u8];
        validity.extend_from_slice(&validity_content);
        // tbsCertificate: serialNumber, issuer, validity
        let mut tbs_content = vec![0x02, 0x01, 0x01];
        tbs_content.extend_from_slice(&[0x30, 0x00]); // issuer
        tbs_content.extend_from_slice(&validity);
        let mut tbs = vec![0x30, tbs_content.len() as u8];
        tbs.extend_from_slice(&tbs_content);
        let mut certificate_content = tbs;
        certificate_content.extend_from_slice(&[0x30, 0x00]); // signatureAlgorithm
        certificate_content.extend_from_slice(&[0x03, 0x01, 0x00]); // signatureValue
        let mut certificate = vec![0x30, certificate_content.len() as u8];
        certificate.extend_from_slice(&certificate_content);
        certificate
    }

    #[test]
    fn reads_a_utc_time_validity_window() {
        let der = certificate("250101000000Z", "350101000000Z");
        let validity = validity(&der).unwrap();
        assert_eq!(validity.not_before, 1_735_689_600);
        assert_eq!(validity.not_after, 2_051_222_400);
    }

    #[test]
    fn rejects_malformed_and_unrelated_input() {
        assert!(validity(&[]).is_none());
        assert!(validity(&[0x30, 0x05, 0x02, 0x01, 0x01]).is_none());
        assert!(validity(&[0x02, 0x01, 0x01]).is_none());
        // A length that runs past the buffer is not parsed.
        assert!(validity(&[0x30, 0x7f, 0x02]).is_none());
    }

    #[test]
    fn civil_days_match_known_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2024, 2, 29), 19_782);
    }
}
