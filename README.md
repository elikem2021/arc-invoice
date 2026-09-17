# ArcInvoice

USDC invoices and lightweight escrow, built for [Arc](https://arc.io), Circle's stablecoin-native L1.

**Live app:** https://arc-invoice-app.vercel.app  
**Contract (Arc mainnet, chain 5042):** see `DEPLOYMENT.md`

## What it does

A freelancer or small business creates an invoice (amount in USDC, a memo, an optional payer restriction, an optional escrow window) and gets a link. The payer opens the link, connects a wallet on Arc, and pays in one transaction.

- **No escrow:** USDC goes straight to the payee.
- **Escrow:** USDC is held by the contract. The payer clicks *Release* on delivery. If the payer goes silent, the payee can *Claim* after the review window closes. The payee can *Refund* the payer at any time before that.

## Why Arc specifically

- USDC is Arc's **native asset**, so `pay()` is a plain `msg.value` transfer. No `approve`, no allowance, no second token for gas. One balance, one step.
- Fees are paid in USDC and are a fraction of a cent, so a $25 invoice does not need a $2 gas budget in a volatile coin.
- Arc finalizes on inclusion (about 0.5 s), so the invoice status flips to paid the moment the transaction lands. No confirmation-count logic.
- The contract respects Arc's value-transfer rules: transfers can revert for protocol reasons (blocklist, zero address), and `_send` bubbles that revert so state never desynchronizes from balances.

## Layout

```
src/ArcInvoice.sol      the contract (no dependencies)
test/ArcInvoice.t.sol   8 Foundry tests
web/                    Vite + viem single-page app
```

## Contract API

| Function | Who | Effect |
| --- | --- | --- |
| `create(payer, amount, escrowSeconds, memo)` | payee | new invoice, returns id. `payer = 0x0` means anyone may pay. `amount` is native USDC (18 decimals). |
| `pay(id)` payable | payer | must send exactly `amount`. Pays through or funds escrow. |
| `release(id)` | payer | escrow → payee |
| `claim(id)` | payee | escrow → payee, only after `fundedAt + escrowSeconds` |
| `refund(id)` | payee | escrow → payer |
| `cancel(id)` | payee | closes an unpaid invoice |
| `get(id)`, `idsByPayee(a)`, `idsByPayer(a)`, `claimableAt(id)` | anyone | views |

## Run locally

```bash
forge test
cd web && npm install && VITE_CONTRACT_ADDRESS=0x... npm run dev
```

## Deploy

```bash
forge create src/ArcInvoice.sol:ArcInvoice --rpc-url https://rpc.mainnet.arc.io --private-key $PRIVATE_KEY --broadcast
```

The deployer needs a little USDC on Arc for gas (deployment costs well under $0.10).

## Status

Proof of concept submitted to the Arc Microgrants program. Next steps if it goes further: EURC invoices, recurring invoices, Memo-contract references for accounting reconciliation, and a hosted email/notification layer.

MIT.
