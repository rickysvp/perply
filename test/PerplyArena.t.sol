// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {PerplyArena} from "../contracts/PerplyArena.sol";

contract PerplyArenaTest is Test {
    uint8 internal constant LONG = 0;
    uint8 internal constant SHORT = 1;
    uint16 internal constant BPS = 10_000;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    PerplyArena internal arena;

    function setUp() public {
        arena = new PerplyArena(100e8);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function testPreviewOpenAndOpenFee() public {
        _deposit(alice, 5 ether);

        (
            uint256 openFee,
            uint16 congestionRate,
            uint256 congestionFee,
            uint256 congestionToOpposite,
            uint256 congestionToTreasury,
            uint256 totalRequired
        ) = arena.previewOpen(LONG, 1 ether, 10);

        assertEq(openFee, 0.01 ether, "open fee must be 1%");
        assertEq(congestionRate, 0, "congestion must be zero for balanced side");
        assertEq(congestionFee, 0, "congestion fee must be zero");
        assertEq(congestionToOpposite, 0, "opposite split must be zero");
        assertEq(congestionToTreasury, 0, "treasury split must be zero");
        assertEq(totalRequired, 1.01 ether, "total required mismatch");

        _open(alice, LONG, 1 ether, 10);

        assertEq(arena.availableBalance(alice), 5 ether - totalRequired, "available balance mismatch");
        assertEq(arena.treasuryBalance(), openFee, "treasury should only hold open fee");
    }

    function testCongestionFeeSplitToOppositeAndTreasury() public {
        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 5);

        _deposit(alice, 10 ether);
        _open(alice, LONG, 2 ether, 5);

        _deposit(carol, 10 ether);
        (
            ,
            uint16 congestionRate,
            uint256 congestionFee,
            uint256 congestionToOpposite,
            uint256 congestionToTreasury,
            uint256 totalRequired
        ) = arena.previewOpen(LONG, 1 ether, 5);

        assertGt(congestionRate, 0, "expected non-zero congestion rate on crowded side");
        assertEq(congestionRate, 29, "unexpected congestion rate for this imbalance");
        assertEq(congestionFee, 0.0029 ether, "unexpected congestion fee");
        assertEq(congestionToOpposite, 0.00232 ether, "unexpected opposite split");
        assertEq(congestionToTreasury, 0.00058 ether, "unexpected treasury split");

        _open(carol, LONG, 1 ether, 5);

        assertEq(
            arena.availableBalance(carol),
            10 ether - totalRequired,
            "available balance should include open and congestion fees"
        );

        uint256 expectedTreasury = 0.04058 ether;
        assertEq(arena.treasuryBalance(), expectedTreasury, "treasury amount mismatch");
        assertEq(
            arena.cumulativeCongestionRewards(SHORT),
            congestionToOpposite,
            "opposite side cumulative rewards mismatch"
        );

        PerplyArena.PositionView memory bobShort = arena.getPosition(bob, SHORT);
        assertEq(bobShort.pnl, int256(congestionToOpposite), "opposite side should receive congestion rewards");
    }

    function testSettlementFeeGoesToTreasuryAndUpdatesCampPnL() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 10);

        vm.warp(block.timestamp + arena.minSettlementInterval());

        uint256 newPrice = 101e8;
        uint256 expectedGross = 0.08 ether;
        uint256 expectedSettlementFee = 0.000008 ether;
        uint256 expectedWinnerNet = 0.079992 ether;

        uint256 treasuryBefore = arena.treasuryBalance();
        arena.settleWithPrice(newPrice);
        uint256 treasuryAfter = arena.treasuryBalance();

        assertEq(
            treasuryAfter - treasuryBefore,
            expectedSettlementFee,
            "settlement fee must be routed to treasury"
        );

        PerplyArena.PositionView memory longPos = arena.getPosition(alice, LONG);
        PerplyArena.PositionView memory shortPos = arena.getPosition(bob, SHORT);

        assertEq(longPos.pnl, int256(expectedWinnerNet), "long side pnl mismatch");
        assertEq(shortPos.pnl, -int256(expectedGross), "short side pnl mismatch");
    }

    function testCloseFeeIsOnePercentOfPositiveEquity() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 10);

        vm.warp(block.timestamp + arena.minSettlementInterval());
        arena.settleWithPrice(101e8);

        PerplyArena.PositionView memory longPos = arena.getPosition(alice, LONG);
        assertTrue(longPos.isOpen, "long must be open before close");
        assertGt(longPos.equity, 0, "long equity should be positive after up-move");

        uint256 expectedCloseFee = (uint256(longPos.equity) * arena.closeFeeBps()) / BPS;
        uint256 treasuryBefore = arena.treasuryBalance();

        _close(alice, LONG);

        assertEq(
            arena.treasuryBalance() - treasuryBefore,
            expectedCloseFee,
            "close fee should equal 1% of positive equity"
        );

        PerplyArena.PositionView memory closed = arena.getPosition(alice, LONG);
        assertFalse(closed.isOpen, "position should be closed");
    }

    function _deposit(address trader, uint256 amount) internal {
        vm.prank(trader);
        arena.deposit{value: amount}();
    }

    function _open(address trader, uint8 side, uint256 margin, uint32 leverage) internal {
        vm.prank(trader);
        arena.openPosition(side, margin, leverage);
    }

    function _close(address trader, uint8 side) internal {
        vm.prank(trader);
        arena.closePosition(side);
    }
}
