// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcInvoice — USDC invoices with optional escrow, native to Arc
/// @notice On Arc, USDC is the native asset (msg.value, 18 decimals), so an
///         invoice can be paid with a plain value transfer: no approve step,
///         no token allowance, and the fee is paid in the same USDC.
///         Amounts in this contract are in native units (1 USDC = 1e18).
contract ArcInvoice {
    enum Status { Open, Paid, Funded, Released, Refunded, Cancelled }

    struct Invoice {
        address payee;        // who gets paid
        address payer;        // optional restriction; address(0) = anyone may pay
        uint128 amount;       // native USDC, 18 decimals
        uint40  createdAt;
        uint40  fundedAt;     // when escrow was funded (0 if not)
        uint32  escrowSeconds; // 0 = pay-through immediately; >0 = hold, payer releases or payee claims after timeout
        Status  status;
        address fundedBy;     // actual payer when funded/paid
        string  memo;         // human-readable reference (invoice number, description)
    }

    uint256 public nextId = 1;
    mapping(uint256 => Invoice) private _invoices;
    mapping(address => uint256[]) private _byPayee;
    mapping(address => uint256[]) private _byPayer;

    uint256 private _lock = 1;
    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    event InvoiceCreated(uint256 indexed id, address indexed payee, address indexed payer, uint256 amount, uint32 escrowSeconds, string memo);
    event InvoicePaid(uint256 indexed id, address indexed payer, uint256 amount);      // direct pay-through
    event InvoiceFunded(uint256 indexed id, address indexed payer, uint256 amount);    // escrow funded
    event InvoiceReleased(uint256 indexed id, address indexed by, uint256 amount);     // payer released or payee claimed after timeout
    event InvoiceRefunded(uint256 indexed id, address indexed payer, uint256 amount);  // payee refunded escrow
    event InvoiceCancelled(uint256 indexed id);

    function create(address payer, uint128 amount, uint32 escrowSeconds, string calldata memo) external returns (uint256 id) {
        require(amount > 0, "amount=0");
        require(bytes(memo).length <= 140, "memo too long");
        id = nextId++;
        Invoice storage inv = _invoices[id];
        inv.payee = msg.sender;
        inv.payer = payer;
        inv.amount = amount;
        inv.createdAt = uint40(block.timestamp);
        inv.escrowSeconds = escrowSeconds;
        inv.status = Status.Open;
        inv.memo = memo;
        _byPayee[msg.sender].push(id);
        if (payer != address(0)) _byPayer[payer].push(id);
        emit InvoiceCreated(id, msg.sender, payer, amount, escrowSeconds, memo);
    }

    /// @notice Pay an open invoice by sending exactly `amount` native USDC.
    function pay(uint256 id) external payable nonReentrant {
        Invoice storage inv = _invoices[id];
        require(inv.payee != address(0), "no invoice");
        require(inv.status == Status.Open, "not open");
        require(inv.payer == address(0) || inv.payer == msg.sender, "not the payer");
        require(msg.value == inv.amount, "wrong amount");
        inv.fundedBy = msg.sender;
        if (inv.payer == address(0)) _byPayer[msg.sender].push(id);
        if (inv.escrowSeconds == 0) {
            inv.status = Status.Paid;
            _send(inv.payee, msg.value);
            emit InvoicePaid(id, msg.sender, msg.value);
        } else {
            inv.status = Status.Funded;
            inv.fundedAt = uint40(block.timestamp);
            emit InvoiceFunded(id, msg.sender, msg.value);
        }
    }

    /// @notice Payer releases escrowed funds to the payee.
    function release(uint256 id) external nonReentrant {
        Invoice storage inv = _invoices[id];
        require(inv.status == Status.Funded, "not funded");
        require(msg.sender == inv.fundedBy, "not the payer");
        inv.status = Status.Released;
        _send(inv.payee, inv.amount);
        emit InvoiceReleased(id, msg.sender, inv.amount);
    }

    /// @notice Payee claims escrowed funds once the payer's review window has elapsed.
    function claim(uint256 id) external nonReentrant {
        Invoice storage inv = _invoices[id];
        require(inv.status == Status.Funded, "not funded");
        require(msg.sender == inv.payee, "not the payee");
        require(block.timestamp >= uint256(inv.fundedAt) + inv.escrowSeconds, "review window open");
        inv.status = Status.Released;
        _send(inv.payee, inv.amount);
        emit InvoiceReleased(id, msg.sender, inv.amount);
    }

    /// @notice Payee returns escrowed funds to the payer (dispute resolution in the payer's favour).
    function refund(uint256 id) external nonReentrant {
        Invoice storage inv = _invoices[id];
        require(inv.status == Status.Funded, "not funded");
        require(msg.sender == inv.payee, "not the payee");
        inv.status = Status.Refunded;
        _send(inv.fundedBy, inv.amount);
        emit InvoiceRefunded(id, inv.fundedBy, inv.amount);
    }

    /// @notice Payee cancels an unpaid invoice.
    function cancel(uint256 id) external {
        Invoice storage inv = _invoices[id];
        require(inv.status == Status.Open, "not open");
        require(msg.sender == inv.payee, "not the payee");
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    // ---- views ----
    function get(uint256 id) external view returns (Invoice memory) {
        require(_invoices[id].payee != address(0), "no invoice");
        return _invoices[id];
    }
    function idsByPayee(address a) external view returns (uint256[] memory) { return _byPayee[a]; }
    function idsByPayer(address a) external view returns (uint256[] memory) { return _byPayer[a]; }
    function claimableAt(uint256 id) external view returns (uint256) {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Funded) return 0;
        return uint256(inv.fundedAt) + inv.escrowSeconds;
    }

    function _send(address to, uint256 amount) private {
        // On Arc a native transfer can revert for protocol reasons (blocklist, zero address).
        // Bubble the failure so state is not left inconsistent.
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "transfer failed");
    }
}
