use anchor_lang::prelude::*;

#[error_code]
pub enum ArenaError {
    #[msg("Arithmetic overflow or underflow")]
    MathOverflow,
    #[msg("Insufficient bankroll for stake")]
    InsufficientBankroll,
    #[msg("Match is not open")]
    MatchNotOpen,
    #[msg("Match must be settled or voided first")]
    MatchStillOpen,
    #[msg("Position already settled")]
    PositionAlreadySettled,
    #[msg("Signer is not the book authority")]
    NotBookAuthority,
    #[msg("Invalid settled outcome code")]
    InvalidOutcome,
    #[msg("Verification config is invalid")]
    InvalidVerificationConfig,
    #[msg("Roots account is not owned by the Txoracle program")]
    WrongRootsOwner,
    #[msg("Roots account key does not match the derived daily_scores_roots PDA")]
    WrongRootsPda,
    #[msg("Anchored root could not be read at the configured offset")]
    RootsOffsetOutOfBounds,
    #[msg("Merkle proof does not reproduce the anchored root")]
    ProofMismatch,
    #[msg("Proof node count exceeds MAX_PROOF_NODES")]
    ProofTooLarge,
    #[msg("Leaf data exceeds MAX_LEAF_DATA")]
    LeafTooLarge,
    #[msg("Proof node side flag must be 0 (left) or 1 (right)")]
    BadProofSide,
}
