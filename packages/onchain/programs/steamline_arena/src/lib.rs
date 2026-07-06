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
}
