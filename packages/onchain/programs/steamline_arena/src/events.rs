use anchor_lang::prelude::*;

#[event]
pub struct ArenaInitialized {
    pub arena: Pubkey,
    pub authority: Pubkey,
    pub season_id: u64,
    pub starting_bankroll: u64,
}

#[event]
pub struct AgentRegistered {
    pub arena: Pubkey,
    pub book: Pubkey,
    pub authority: Pubkey,
    pub bankroll_points: u64,
}

#[event]
pub struct MatchOpened {
    pub arena: Pubkey,
    pub game: Pubkey,
    pub fixture_id: u64,
    pub start_time: i64,
}

#[event]
pub struct PositionOpened {
    pub game: Pubkey,
    pub book: Pubkey,
    pub position: Pubkey,
    pub outcome: u8,
    pub stake_points: u64,
    pub entry_odds_milli: u32,
    pub signal_seq: u64,
}

#[event]
pub struct MatchSettled {
    pub game: Pubkey,
    pub fixture_id: u64,
    pub settled_outcome: u8,
    pub verified: bool,
}

#[event]
pub struct MatchVoided {
    pub game: Pubkey,
    pub fixture_id: u64,
}

#[event]
pub struct PositionSettled {
    pub game: Pubkey,
    pub book: Pubkey,
    pub position: Pubkey,
    pub status: u8,
    pub payout_points: u64,
}
