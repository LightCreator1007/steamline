use anchor_lang::prelude::*;

pub const SEED_ARENA: &[u8] = b"arena";
pub const SEED_BOOK: &[u8] = b"book";
pub const SEED_MATCH: &[u8] = b"match";
pub const SEED_POSITION: &[u8] = b"pos";

pub const MAX_PROOF_NODES: usize = 20;
pub const MAX_LEAF_DATA: usize = 256;
pub const ROOT_PREFIX_MAX: usize = 24;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_SETTLED: u8 = 1;
pub const STATUS_VOIDED: u8 = 2;

pub const POS_OPEN: u8 = 0;
pub const POS_WON: u8 = 1;
pub const POS_LOST: u8 = 2;
pub const POS_REFUNDED: u8 = 3;

pub const OUTCOME_HOME: u8 = 0;
pub const OUTCOME_DRAW: u8 = 1;
pub const OUTCOME_AWAY: u8 = 2;
pub const OUTCOME_NONE: u8 = 255;

pub fn derive_outcome(home: u16, away: u16) -> u8 {
    if home > away {
        OUTCOME_HOME
    } else if home < away {
        OUTCOME_AWAY
    } else {
        OUTCOME_DRAW
    }
}

#[account]
#[derive(InitSpace)]
pub struct Arena {
    pub authority: Pubkey,
    pub season_id: u64,
    pub match_count: u64,
    pub starting_bankroll: u64,
    // Verification config (resolves open items: roots PDA width and root offset).
    pub txoracle_program: Pubkey,
    pub scores_root_prefix: [u8; ROOT_PREFIX_MAX],
    pub scores_root_prefix_len: u8,
    pub epoch_day_width: u8,
    pub roots_data_offset: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentBook {
    pub arena: Pubkey,
    pub authority: Pubkey,
    pub strategy_tag: [u8; 16],
    pub bankroll_points: u64,
    pub staked_points: u64,
    pub realized_pnl: i64,
    pub bets_opened: u32,
    pub bets_won: u32,
    pub bets_lost: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Match {
    pub arena: Pubkey,
    pub fixture_id: u64,
    pub status: u8,
    pub start_time: i64,
    pub home_score: u16,
    pub away_score: u16,
    pub settled_outcome: u8,
    pub verified: bool,
    pub score_proof_ref: [u8; 32],
    pub settled_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub game: Pubkey,
    pub book: Pubkey,
    pub signal_seq: u64,
    pub outcome: u8,
    pub stake_points: u64,
    pub entry_odds_milli: u32,
    pub edge_bps: i32,
    pub odds_msg_ref: [u8; 32],
    pub odds_ts: i64,
    pub status: u8,
    pub payout_points: u64,
    pub bump: u8,
}
