use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::ROOT_PREFIX_MAX;

declare_id!("E9jfScHBJRB2NyB2NFmE4Kec9D8hJ1X7k24AXufRbX5n");

#[program]
pub mod steamline_arena {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize_arena(
        ctx: Context<InitializeArena>,
        season_id: u64,
        starting_bankroll: u64,
        txoracle_program: Pubkey,
        scores_root_prefix: [u8; ROOT_PREFIX_MAX],
        scores_root_prefix_len: u8,
        epoch_day_width: u8,
        roots_data_offset: u16,
    ) -> Result<()> {
        instructions::initialize_arena::handler(
            ctx,
            season_id,
            starting_bankroll,
            txoracle_program,
            scores_root_prefix,
            scores_root_prefix_len,
            epoch_day_width,
            roots_data_offset,
        )
    }

    pub fn register_agent(ctx: Context<RegisterAgent>, strategy_tag: [u8; 16]) -> Result<()> {
        instructions::register_agent::handler(ctx, strategy_tag)
    }

    pub fn open_match(ctx: Context<OpenMatch>, fixture_id: u64, start_time: i64) -> Result<()> {
        instructions::open_match::handler(ctx, fixture_id, start_time)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_position(
        ctx: Context<OpenPosition>,
        fixture_id: u64,
        outcome: u8,
        stake_points: u64,
        entry_odds_milli: u32,
        edge_bps: i32,
        odds_msg_ref: [u8; 32],
        odds_ts: i64,
        signal_seq: u64,
    ) -> Result<()> {
        instructions::open_position::handler(
            ctx,
            fixture_id,
            outcome,
            stake_points,
            entry_odds_milli,
            edge_bps,
            odds_msg_ref,
            odds_ts,
            signal_seq,
        )
    }
}
