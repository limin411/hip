//! Shared interactive-terminal soft cap (local PTY + SSH).
//!
//! Authoritative alive-slot counter. Lock order: **Budget → PtyManager / SshManager**
//! (never reverse). See design K5 / soft-cap section.

use std::collections::HashSet;
use std::sync::Mutex;

/// Max concurrent alive interactive terminals (code-panel PTY + managed local + SSH).
pub const MAX_INTERACTIVE_TERMINALS: usize = 8;

/// Soft-cap: allow open if session already has a slot, or **alive** count has room.
///
/// Reused by PTY and SSH. Pure — unit-tested.
pub fn soft_cap_allows(alive_count: usize, session_exists: bool, max: usize) -> bool {
    session_exists || alive_count < max
}

/// Shared budget of alive terminal ids across backends.
pub struct TerminalBudget {
    /// Currently alive interactive terminal ids (PTY + SSH).
    alive: Mutex<HashSet<String>>,
}

impl TerminalBudget {
    pub fn new() -> Self {
        Self {
            alive: Mutex::new(HashSet::new()),
        }
    }

    /// Number of alive slots currently held.
    pub fn alive_count(&self) -> usize {
        self.alive.lock().unwrap().len()
    }

    /// Whether `id` currently holds an alive slot.
    pub fn is_alive(&self, id: &str) -> bool {
        self.alive.lock().unwrap().contains(id)
    }

    /// Try to acquire an alive slot for `id`.
    ///
    /// - Already alive → Ok (reopen / reuse; does not consume a new slot).
    /// - `session_exists` (id already known to a manager, even if dead) → allow even at cap.
    /// - Otherwise require `alive_count < MAX`.
    ///
    /// On success of a new acquire, `id` is inserted into the alive set immediately
    /// (reservation). Caller must [`release`] if the open fails after a fresh acquire.
    ///
    /// Returns `true` if this call newly reserved the slot (caller owns cleanup on fail),
    /// `false` if the id was already alive.
    pub fn try_acquire(&self, id: &str, session_exists: bool) -> Result<bool, String> {
        let mut set = self.alive.lock().unwrap();
        if set.contains(id) {
            return Ok(false);
        }
        if !soft_cap_allows(set.len(), session_exists, MAX_INTERACTIVE_TERMINALS) {
            return Err(format!(
                "Too many terminals open (max {MAX_INTERACTIVE_TERMINALS}). Close a session first."
            ));
        }
        set.insert(id.to_string());
        Ok(true)
    }

    /// Drop an alive slot (session exit / kill / failed open after acquire).
    pub fn release(&self, id: &str) {
        self.alive.lock().unwrap().remove(id);
    }
}

impl Default for TerminalBudget {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soft_cap_logic() {
        assert!(soft_cap_allows(0, false, 8));
        assert!(soft_cap_allows(7, false, 8));
        assert!(!soft_cap_allows(8, false, 8));
        assert!(soft_cap_allows(8, true, 8)); // existing session always allowed
        assert!(soft_cap_allows(100, true, 8));
    }

    #[test]
    fn try_acquire_caps_new_ids() {
        let b = TerminalBudget::new();
        for i in 0..MAX_INTERACTIVE_TERMINALS {
            assert_eq!(b.try_acquire(&format!("t{i}"), false).unwrap(), true);
        }
        assert_eq!(b.alive_count(), MAX_INTERACTIVE_TERMINALS);
        let err = b.try_acquire("overflow", false).unwrap_err();
        assert!(err.contains("Too many terminals"), "{err}");
        // Existing id may reopen even at cap.
        assert_eq!(b.try_acquire("overflow", true).unwrap(), true);
        // Already-alive returns false (not newly reserved).
        assert_eq!(b.try_acquire("t0", false).unwrap(), false);
    }

    #[test]
    fn release_frees_slot() {
        let b = TerminalBudget::new();
        for i in 0..MAX_INTERACTIVE_TERMINALS {
            b.try_acquire(&format!("t{i}"), false).unwrap();
        }
        b.release("t0");
        assert_eq!(b.try_acquire("new", false).unwrap(), true);
        assert!(!b.is_alive("t0"));
        assert!(b.is_alive("new"));
    }
}
