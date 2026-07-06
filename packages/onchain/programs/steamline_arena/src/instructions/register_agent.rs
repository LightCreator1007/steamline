use anchor_lang::prelude::*;

use crate::events::AgentRegistered;
use crate::state::{AgentBook, Arena, SEED_BOOK};

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub arena: Account<'info, Arena>,
    #[account(
        init,
        payer = authority,
        space = AgentBook::DISCRIMINATOR.len() + AgentBook::INIT_SPACE,
        seeds = [SEED_BOOK, arena.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub book: Account<'info, AgentBook>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterAgent>, strategy_tag: [u8; 16]) -> Result<()> {
    let arena = &ctx.accounts.arena;
    let book = &mut ctx.accounts.book;
    book.arena = arena.key();
    book.authority = ctx.accounts.authority.key();
    book.strategy_tag = strategy_tag;
    book.bankroll_points = arena.starting_bankroll;
    book.staked_points = 0;
    book.realized_pnl = 0;
    book.bets_opened = 0;
    book.bets_won = 0;
    book.bets_lost = 0;
    book.bump = ctx.bumps.book;

    emit!(AgentRegistered {
        arena: arena.key(),
        book: book.key(),
        authority: book.authority,
        bankroll_points: book.bankroll_points,
    });
    Ok(())
}
