import { createPublicClient, createWalletClient, custom, http, formatUnits, parseUnits, defineChain, getAddress } from 'viem';
import { ABI } from './abi.js';

export const arc = defineChain({
  id: 5042, name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
});
const CONTRACT = import.meta.env.VITE_CONTRACT_ADDRESS;
const STATUS = ['Open', 'Paid', 'Funded', 'Released', 'Refunded', 'Cancelled'];
const pub = createPublicClient({ chain: arc, transport: http() });
let wallet = null, account = null;

const $ = (s) => document.querySelector(s);
const app = $('#app');
document.querySelector('#contractLink').href = `${arc.blockExplorers.default.url}/address/${CONTRACT}`;
const fmt = (v) => { const n = Number(formatUnits(v, 18)); return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }); };
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
const when = (t) => t ? new Date(Number(t) * 1000).toLocaleString() : '—';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dur = (s) => { s = Number(s); if (!s) return 'Pay through (no escrow)'; if (s % 86400 === 0) return `${s / 86400} day review window`; if (s % 3600 === 0) return `${s / 3600} hour review window`; return `${s}s review window`; };

async function connect() {
  if (!window.ethereum) { alert('No wallet found. Install MetaMask, Rabby or Coinbase Wallet.'); return; }
  wallet = createWalletClient({ chain: arc, transport: custom(window.ethereum) });
  const [a] = await wallet.requestAddresses();
  account = getAddress(a);
  try { await wallet.switchChain({ id: arc.id }); }
  catch (e) { await wallet.addChain({ chain: arc }); await wallet.switchChain({ id: arc.id }); }
  $('#connect').textContent = short(account);
  route();
}
$('#connect').onclick = connect;
if (window.ethereum) window.ethereum.on?.('accountsChanged', () => location.reload());

async function write(fn, args, value) {
  if (!account) await connect();
  const hash = await wallet.writeContract({ address: CONTRACT, abi: ABI, functionName: fn, args, value, account, maxFeePerGas: 25_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('Transaction reverted');
  return rc;
}

function route() {
  const id = new URLSearchParams(location.search).get('id');
  id ? renderInvoice(BigInt(id)) : renderHome();
}
window.addEventListener('popstate', route);

function renderHome() {
  app.innerHTML = `
  <section class="hero"><h1>Get paid in USDC on Arc, from a link.</h1>
  <p>Create an invoice, send the link, done. The payer sends USDC in one step (it's Arc's native asset, so there's no approve step) and the fee is a fraction of a cent, also in USDC. Add an escrow window when you want the client to fund first and release on delivery.</p></section>
  <div class="grid">
    <div class="card"><h2>New invoice</h2>
      <label>Amount (USDC)</label><input id="amount" type="number" min="0.000001" step="0.01" placeholder="250.00">
      <label>Reference / memo <span class="muted">(max 140 chars, public)</span></label><input id="memo" maxlength="140" placeholder="INV-1042 · Landing page build, milestone 1">
      <label>Escrow</label>
      <select id="escrow"><option value="0">None: funds go straight to me</option><option value="259200">3-day review window</option><option value="604800">7-day review window</option><option value="1209600">14-day review window</option></select>
      <label>Restrict payer to one address <span class="muted">(optional)</span></label><input id="payer" placeholder="0x…">
      <div class="actions"><button id="create" class="btn">Create invoice</button></div>
      <div id="cmsg" class="msg"></div>
    </div>
    <div class="card"><h2>How escrow works</h2>
      <ol class="steps"><li>You create an invoice with a review window.</li><li>The client funds it. USDC is held by the contract, not by us.</li><li>You deliver. The client clicks Release and you're paid instantly.</li><li>If the client goes quiet, you can claim after the window closes. If you agree to a refund, you can return it any time before that.</li></ol>
      <p class="msg">Arc finalizes on inclusion (about half a second), so a paid invoice is settled the moment the transaction lands.</p>
    </div>
  </div>
  <div class="card" style="margin-top:18px"><h2>Your invoices</h2><div id="mine" class="list"><span class="msg">${account ? 'Loading…' : 'Connect a wallet to see invoices you issued or paid.'}</span></div></div>`;
  $('#create').onclick = onCreate;
  if (account) loadMine();
}

async function onCreate() {
  const m = $('#cmsg'); m.className = 'msg';
  try {
    const amount = parseUnits(($('#amount').value || '0').trim(), 18);
    if (amount <= 0n) throw new Error('Enter an amount');
    const memo = $('#memo').value.trim();
    const escrow = Number($('#escrow').value);
    const payerRaw = $('#payer').value.trim();
    const payer = payerRaw ? getAddress(payerRaw) : '0x0000000000000000000000000000000000000000';
    $('#create').disabled = true; m.textContent = 'Confirm in your wallet…';
    const rc = await write('create', [payer, amount, escrow, memo]);
    const log = rc.logs.find(l => l.address.toLowerCase() === CONTRACT.toLowerCase());
    const id = BigInt(log.topics[1]);
    history.pushState({}, '', `/?id=${id}`); route();
  } catch (e) { m.className = 'msg err'; m.textContent = e.shortMessage || e.message; $('#create').disabled = false; }
}

async function loadMine() {
  const [issued, paid] = await Promise.all([
    pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'idsByPayee', args: [account] }),
    pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'idsByPayer', args: [account] }),
  ]);
  const ids = [...new Set([...issued, ...paid].map(String))].map(BigInt).sort((a, b) => (a < b ? 1 : -1));
  const box = $('#mine');
  if (!ids.length) { box.innerHTML = '<span class="msg">No invoices yet.</span>'; return; }
  const invs = await Promise.all(ids.map(id => pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'get', args: [id] })));
  box.innerHTML = invs.map((v, i) => `<a class="item" href="/?id=${ids[i]}"><span>#${ids[i]} <span class="m">${esc(v.memo) || '—'}</span></span><span>${fmt(v.amount)} USDC <span class="pill ${STATUS[v.status]}">${STATUS[v.status]}</span></span></a>`).join('');
  box.querySelectorAll('a').forEach(a => a.onclick = (e) => { e.preventDefault(); history.pushState({}, '', a.getAttribute('href')); route(); });
}

async function renderInvoice(id) {
  app.innerHTML = '<p class="msg">Loading invoice…</p>';
  let v; try { v = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'get', args: [id] }); }
  catch { app.innerHTML = `<div class="card"><h2>Invoice #${id} not found</h2><a href="/">Back</a></div>`; return; }
  const st = STATUS[v.status];
  const me = account?.toLowerCase();
  const isPayee = me && me === v.payee.toLowerCase();
  const isPayer = me && me === v.fundedBy.toLowerCase();
  const openTo = v.payer === '0x0000000000000000000000000000000000000000' ? 'anyone' : short(v.payer);
  const claimAt = v.status === 2 ? Number(v.fundedAt) + Number(v.escrowSeconds) : 0;
  const now = Math.floor(Date.now() / 1000);
  const link = `${location.origin}/?id=${id}`;
  app.innerHTML = `
  <div class="grid">
    <div class="card">
      <span class="pill ${st}">${st}</span>
      <div class="amt">${fmt(v.amount)} <small>USDC</small></div>
      <div class="kv">
        <div>Invoice</div><div>#${id}</div>
        <div>Memo</div><div>${esc(v.memo) || '—'}</div>
        <div>Payee</div><div class="mono">${v.payee}</div>
        <div>Payable by</div><div>${openTo}</div>
        <div>Escrow</div><div>${dur(v.escrowSeconds)}</div>
        <div>Created</div><div>${when(v.createdAt)}</div>
        ${v.fundedBy !== '0x0000000000000000000000000000000000000000' ? `<div>Paid by</div><div class="mono">${v.fundedBy}</div>` : ''}
        ${claimAt ? `<div>Claimable by payee</div><div>${when(claimAt)}</div>` : ''}
      </div>
      <div class="actions" id="acts"></div>
      <div id="imsg" class="msg"></div>
    </div>
    <div class="card"><h2>Share</h2>
      <p class="msg">Send this link. The payer opens it, connects a wallet on Arc, and pays in one transaction.</p>
      <div class="share"><input readonly value="${link}"><button class="btn sec" id="copy">Copy</button></div>
      <p class="msg">Fee estimate: under $0.01, paid in USDC. Settlement is final on inclusion.</p>
      <p><a href="/" id="home">← Create another invoice</a></p>
    </div>
  </div>`;
  $('#copy').onclick = () => navigator.clipboard.writeText(link).then(() => $('#copy').textContent = 'Copied');
  $('#home').onclick = (e) => { e.preventDefault(); history.pushState({}, '', '/'); route(); };
  const acts = $('#acts'); const msg = $('#imsg');
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = async () => { try { acts.querySelectorAll('button').forEach(x => x.disabled = true); msg.className = 'msg'; msg.textContent = 'Confirm in your wallet…'; await fn(); msg.className = 'msg ok'; msg.textContent = 'Done. Settled on Arc.'; renderInvoice(id); } catch (e) { msg.className = 'msg err'; msg.textContent = e.shortMessage || e.message; acts.querySelectorAll('button').forEach(x => x.disabled = false); } }; acts.appendChild(b); };
  if (v.status === 0) {
    if (!isPayee) btn(`Pay ${fmt(v.amount)} USDC`, '', () => write('pay', [id], v.amount));
    if (isPayee) btn('Cancel invoice', 'sec', () => write('cancel', [id]));
  }
  if (v.status === 2) {
    if (isPayer) btn('Release to payee', '', () => write('release', [id]));
    if (isPayee && now >= claimAt) btn('Claim (window closed)', '', () => write('claim', [id]));
    if (isPayee) btn('Refund payer', 'sec', () => write('refund', [id]));
  }
  if (!account && v.status === 0) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Connect wallet to pay'; b.onclick = connect; acts.appendChild(b); }
}
route();
