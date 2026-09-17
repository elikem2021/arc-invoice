// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ArcInvoice.sol";

contract ArcInvoiceTest is Test {
    ArcInvoice inv;
    address payee = makeAddr("payee");
    address payer = makeAddr("payer");
    address other = makeAddr("other");
    uint128 constant AMT = 25e18; // 25 USDC

    function setUp() public {
        inv = new ArcInvoice();
        vm.deal(payer, 1000e18);
        vm.deal(other, 1000e18);
    }

    function test_directPay() public {
        vm.prank(payee);
        uint256 id = inv.create(address(0), AMT, 0, "INV-1001");
        assertEq(id, 1);
        vm.prank(payer);
        inv.pay{value: AMT}(id);
        assertEq(payee.balance, AMT);
        assertEq(uint(inv.get(id).status), uint(ArcInvoice.Status.Paid));
        assertEq(inv.idsByPayee(payee).length, 1);
        assertEq(inv.idsByPayer(payer).length, 1);
    }

    function test_wrongAmountReverts() public {
        vm.prank(payee);
        uint256 id = inv.create(address(0), AMT, 0, "x");
        vm.prank(payer);
        vm.expectRevert(bytes("wrong amount"));
        inv.pay{value: AMT - 1}(id);
    }

    function test_restrictedPayer() public {
        vm.prank(payee);
        uint256 id = inv.create(payer, AMT, 0, "x");
        vm.prank(other);
        vm.expectRevert(bytes("not the payer"));
        inv.pay{value: AMT}(id);
        vm.prank(payer);
        inv.pay{value: AMT}(id);
        assertEq(payee.balance, AMT);
    }

    function test_escrowRelease() public {
        vm.prank(payee);
        uint256 id = inv.create(address(0), AMT, 7 days, "milestone 1");
        vm.prank(payer);
        inv.pay{value: AMT}(id);
        assertEq(address(inv).balance, AMT);
        assertEq(uint(inv.get(id).status), uint(ArcInvoice.Status.Funded));
        vm.prank(other);
        vm.expectRevert(bytes("not the payer"));
        inv.release(id);
        vm.prank(payer);
        inv.release(id);
        assertEq(payee.balance, AMT);
        assertEq(address(inv).balance, 0);
    }

    function test_escrowClaimAfterWindow() public {
        vm.prank(payee);
        uint256 id = inv.create(address(0), AMT, 7 days, "m");
        vm.prank(payer);
        inv.pay{value: AMT}(id);
        vm.prank(payee);
        vm.expectRevert(bytes("review window open"));
        inv.claim(id);
        vm.warp(block.timestamp + 7 days);
        vm.prank(payee);
        inv.claim(id);
        assertEq(payee.balance, AMT);
    }

    function test_escrowRefund() public {
        vm.prank(payee);
        uint256 id = inv.create(address(0), AMT, 7 days, "m");
        uint256 before = payer.balance;
        vm.prank(payer);
        inv.pay{value: AMT}(id);
        vm.prank(payer);
        vm.expectRevert(bytes("not the payee"));
        inv.refund(id);
        vm.prank(payee);
        inv.refund(id);
        assertEq(payer.balance, before);
        assertEq(uint(inv.get(id).status), uint(ArcInvoice.Status.Refunded));
    }

    function test_cancelAndNoDoublePay() public {
        vm.prank(payee);
        uint256 id = inv.create(address(0), AMT, 0, "m");
        vm.prank(payee);
        inv.cancel(id);
        vm.prank(payer);
        vm.expectRevert(bytes("not open"));
        inv.pay{value: AMT}(id);
    }

    function test_memoLimit() public {
        string memory long = new string(141);
        vm.prank(payee);
        vm.expectRevert(bytes("memo too long"));
        inv.create(address(0), AMT, 0, long);
    }
}
