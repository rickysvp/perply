// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {PerplyArena} from "../contracts/PerplyArena.sol";

contract PerplyArenaTest is Test {
    uint8 internal constant LONG = 0;
    uint8 internal constant SHORT = 1;
    uint16 internal constant BPS = 10_000;

    uint256 internal signerPk = 0xA11CE;
    uint64 internal priceSalt;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal signer;

    PerplyArena internal arena;

    function setUp() public {
        arena = new PerplyArena(100e8);
        signer = vm.addr(signerPk);
        arena.setPriceSigner(signer);
        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executePriceSignerUpdate();
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

        assertEq(openFee, 0.005 ether, "open fee must be 0.5%");
        assertEq(congestionRate, 0, "congestion must be zero for balanced side");
        assertEq(congestionFee, 0, "congestion fee must be zero");
        assertEq(congestionToOpposite, 0, "opposite split must be zero");
        assertEq(congestionToTreasury, 0, "treasury split must be zero");
        assertEq(totalRequired, 1.005 ether, "total required mismatch");

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

        uint256 expectedTreasury = 0.02058 ether;
        assertEq(arena.treasuryBalance(), expectedTreasury, "treasury amount mismatch");
        assertEq(
            arena.cumulativeCongestionRewards(SHORT),
            congestionToOpposite,
            "opposite side cumulative rewards mismatch"
        );

        PerplyArena.PositionView memory bobShort = arena.getPosition(bob, SHORT);
        assertEq(bobShort.pnl, _toInt256Safe(congestionToOpposite), "opposite side should receive congestion rewards");
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
        _settleSigned(newPrice);
        uint256 treasuryAfter = arena.treasuryBalance();

        assertEq(
            treasuryAfter - treasuryBefore,
            expectedSettlementFee,
            "settlement fee must be routed to treasury"
        );

        PerplyArena.PositionView memory longPos = arena.getPosition(alice, LONG);
        PerplyArena.PositionView memory shortPos = arena.getPosition(bob, SHORT);

        assertEq(longPos.pnl, _toInt256Safe(expectedWinnerNet), "long side pnl mismatch");
        assertEq(shortPos.pnl, -_toInt256Safe(expectedGross), "short side pnl mismatch");
    }

    function testLargeMoveCreatesPendingDebtAndCloseCannotEscapeLoss() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 10);

        vm.warp(block.timestamp + arena.minSettlementInterval());
        _settleSigned(150e8);

        // raw transfer = 4.0, but per-tick realization capped to loser side margin * 30% = 0.3
        assertEq(arena.sidePendingSettlementDebt(SHORT), 3.7 ether, "pending debt must track uncapped loss");

        PerplyArena.PositionView memory shortPos = arena.getPosition(bob, SHORT);
        PerplyArena.PositionView memory longPos = arena.getPosition(alice, LONG);
        assertEq(shortPos.pnl, -_toInt256Safe(4 ether), "short side must take full raw loss immediately");
        assertEq(longPos.pnl, _toInt256Safe(0.29997 ether), "long side should only receive capped realized payout");

        uint256 badDebtBefore = arena.systemBadDebt();
        _close(bob, SHORT);
        assertGt(arena.systemBadDebt(), badDebtBefore, "closing losing side must not bypass pending loss");
    }

    function testPendingDebtContinuesRealizingOnLaterTicksWithoutNewPriceMove() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 10);

        vm.warp(block.timestamp + arena.minSettlementInterval());
        _settleSigned(150e8);
        assertEq(arena.sidePendingSettlementDebt(SHORT), 3.7 ether, "first realization pending debt mismatch");

        vm.warp(block.timestamp + arena.minSettlementInterval());
        _settleSigned(150e8);

        // second tick should drain another capped 0.3 from existing debt even with flat price
        assertEq(arena.sidePendingSettlementDebt(SHORT), 3.4 ether, "second realization pending debt mismatch");

        PerplyArena.PositionView memory longPos = arena.getPosition(alice, LONG);
        PerplyArena.PositionView memory shortPos = arena.getPosition(bob, SHORT);
        assertEq(longPos.pnl, _toInt256Safe(0.59994 ether), "long side should accumulate realized payout over ticks");
        assertEq(shortPos.pnl, -_toInt256Safe(4 ether), "short side loss should remain locked after initial debt accrual");
    }

    function testCloseFeeIsHalfPercentOfPositiveEquity() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 10);

        vm.warp(block.timestamp + arena.minSettlementInterval());
        _settleSigned(101e8);

        PerplyArena.PositionView memory longPos = arena.getPosition(alice, LONG);
        assertTrue(longPos.isOpen, "long must be open before close");
        assertGt(longPos.equity, 0, "long equity should be positive after up-move");

        uint256 expectedCloseFee = (uint256(longPos.equity) * arena.closeFeeBps()) / BPS;
        uint256 treasuryBefore = arena.treasuryBalance();

        _close(alice, LONG);

        assertEq(
            arena.treasuryBalance() - treasuryBefore,
            expectedCloseFee,
            "close fee should equal 0.5% of positive equity"
        );

        PerplyArena.PositionView memory closed = arena.getPosition(alice, LONG);
        assertFalse(closed.isOpen, "position should be closed");
    }

    function testDirectSettlementDisabledByDefault() public {
        vm.expectRevert(PerplyArena.DirectSettlementDisabled.selector);
        arena.settleWithPrice(101e8);
    }

    function testSignedSettlementRejectsReplay() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);
        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 10);

        vm.warp(block.timestamp + arena.minSettlementInterval());
        uint64 timestamp = uint64(block.timestamp);
        uint64 salt = ++priceSalt;
        bytes memory sig = _signPrice(101e8, timestamp, salt);

        arena.settleWithSignedPrice(101e8, timestamp, salt, sig);
        vm.expectRevert(PerplyArena.SignatureAlreadyUsed.selector);
        arena.settleWithSignedPrice(101e8, timestamp, salt, sig);
    }

    function testSignedSettlementRequiresOwnerOrKeeperCaller() public {
        uint64 timestamp = uint64(block.timestamp);
        uint64 salt = ++priceSalt;
        bytes memory sig = _signPrice(101e8, timestamp, salt);

        vm.prank(alice);
        vm.expectRevert(PerplyArena.UnauthorizedKeeper.selector);
        arena.settleWithSignedPrice(101e8, timestamp, salt, sig);
    }

    function testSignedSettlementRejectsPriceOutOfRange() public {
        uint256 tooLargePrice = uint256(type(uint64).max) + 1;
        uint64 timestamp = uint64(block.timestamp);
        uint64 salt = ++priceSalt;
        bytes memory sig = _signPrice(tooLargePrice, timestamp, salt);
        vm.expectRevert(PerplyArena.PriceOutOfRange.selector);
        arena.settleWithSignedPrice(tooLargePrice, timestamp, salt, sig);
    }

    function testSignedSettlementRejectsStalePrice() public {
        vm.warp(block.timestamp + uint256(arena.maxPriceAgeSec()) + 2);
        uint64 staleTimestamp = uint64(block.timestamp - uint256(arena.maxPriceAgeSec()) - 1);
        bytes memory sig = _signPrice(101e8, staleTimestamp, ++priceSalt);
        vm.expectRevert(PerplyArena.StalePrice.selector);
        arena.settleWithSignedPrice(101e8, staleTimestamp, priceSalt, sig);
    }

    function testSignedSettlementRejectsNonIncreasingTimestamp() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);
        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 10);

        vm.warp(block.timestamp + arena.minSettlementInterval());
        uint64 timestamp = uint64(block.timestamp);

        bytes memory sig1 = _signPrice(101e8, timestamp, ++priceSalt);
        arena.settleWithSignedPrice(101e8, timestamp, priceSalt, sig1);

        bytes memory sig2 = _signPrice(102e8, timestamp, ++priceSalt);
        vm.expectRevert(PerplyArena.StalePrice.selector);
        arena.settleWithSignedPrice(102e8, timestamp, priceSalt, sig2);
    }

    function testPauseBlocksDepositButAllowsRiskReduction() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        arena.setPaused(true);

        vm.prank(bob);
        vm.expectRevert(PerplyArena.Paused.selector);
        arena.deposit{value: 1 ether}();

        _close(alice, LONG);
        assertFalse(arena.getPosition(alice, LONG).isOpen, "close should still work in paused mode");
    }

    function testPauseDisableIsTimelocked() public {
        arena.setPaused(true);
        arena.setPaused(false);
        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executePauseDisable();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executePauseDisable();
        assertFalse(arena.paused(), "pause disable should execute after timelock");
    }

    function testEmergencyGuardianCanActivatePause() public {
        address guardian = makeAddr("guardian");
        arena.setEmergencyGuardian(guardian);
        vm.prank(guardian);
        arena.setPaused(true);
        assertTrue(arena.paused(), "guardian should be able to activate pause");

        vm.prank(guardian);
        vm.expectRevert(PerplyArena.OnlyOwner.selector);
        arena.setPaused(false);
    }

    function testReduceOnlyBlocksOpenButAllowsClose() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        _deposit(bob, 10 ether);
        arena.setReduceOnly(true);

        vm.prank(bob);
        vm.expectRevert(PerplyArena.ReduceOnly.selector);
        arena.openPosition(SHORT, 1 ether, 10);

        _close(alice, LONG);
        assertFalse(arena.getPosition(alice, LONG).isOpen, "close should still work in reduce-only mode");
    }

    function testReduceOnlyDisableIsTimelocked() public {
        arena.setReduceOnly(true);
        arena.setReduceOnly(false);
        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executeReduceOnlyDisable();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executeReduceOnlyDisable();
        assertFalse(arena.reduceOnly(), "reduce-only disable should execute after timelock");
    }

    function testEmergencyGuardianCanActivateReduceOnly() public {
        address guardian = makeAddr("guardian");
        arena.setEmergencyGuardian(guardian);
        vm.prank(guardian);
        arena.setReduceOnly(true);
        assertTrue(arena.reduceOnly(), "guardian should be able to activate reduce-only");

        vm.prank(guardian);
        vm.expectRevert(PerplyArena.OnlyOwner.selector);
        arena.setReduceOnly(false);
    }

    function testRiskParamsTimelockQueueAndExecute() public {
        arena.setRiskParams(
            20,
            20,
            7000,
            2500,
            40,
            40,
            1,
            1000,
            5000,
            60,
            700,
            35,
            250,
            5000
        );

        assertTrue(arena.hasQueuedRiskParams(), "queue must be active");
        vm.expectRevert(PerplyArena.RiskParamsTimelockPending.selector);
        arena.executeRiskParams();

        vm.warp(block.timestamp + arena.riskParamsTimelockSec());
        arena.executeRiskParams();

        assertEq(arena.minSettlementInterval(), 20, "min settlement interval mismatch");
        assertEq(arena.openFeeBps(), 40, "open fee mismatch");
        assertEq(arena.closeFeeBps(), 40, "close fee mismatch");
        assertEq(arena.maxCongestionFeeBps(), 60, "congestion cap mismatch");
    }

    function testRiskParamsBoundsEnforced() public {
        vm.expectRevert(PerplyArena.InvalidAmount.selector);
        arena.setRiskParams(
            10,
            15,
            8000,
            3000,
            501, // > 5%
            50,
            1,
            1000,
            5000,
            50,
            600,
            40,
            200,
            5000
        );
    }

    function testRiskParamsCannotOverwritePendingQueue() public {
        arena.setRiskParams(
            20,
            20,
            7000,
            2500,
            40,
            40,
            1,
            1000,
            5000,
            60,
            700,
            35,
            250,
            5000
        );

        vm.expectRevert(PerplyArena.RiskParamsAlreadyQueued.selector);
        arena.setRiskParams(
            30,
            20,
            7000,
            2500,
            45,
            45,
            1,
            1200,
            5500,
            70,
            750,
            40,
            260,
            5500
        );
    }

    function testKeeperUpdateIsTimelocked() public {
        address newKeeper = makeAddr("newKeeper");
        arena.setKeeper(newKeeper);

        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executeKeeperUpdate();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executeKeeperUpdate();
        assertEq(arena.keeper(), newKeeper, "keeper update should execute after timelock");
    }

    function testOwnershipTransferIsTimelocked() public {
        address newOwner = makeAddr("newOwner");
        arena.transferOwnership(newOwner);

        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executeOwnershipTransfer();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executeOwnershipTransfer();
        assertEq(arena.owner(), newOwner, "ownership transfer should execute after timelock");
    }

    function testOwnershipTransferCannotOverwritePendingQueue() public {
        arena.transferOwnership(makeAddr("ownerOne"));
        vm.expectRevert(PerplyArena.AdminOperationAlreadyQueued.selector);
        arena.transferOwnership(makeAddr("ownerTwo"));
    }

    function testKeeperUpdateCannotOverwritePendingQueue() public {
        arena.setKeeper(makeAddr("keeperOne"));
        vm.expectRevert(PerplyArena.AdminOperationAlreadyQueued.selector);
        arena.setKeeper(makeAddr("keeperTwo"));
    }

    function testPriceSignerUpdateCannotOverwritePendingQueue() public {
        arena.setPriceSigner(makeAddr("signerOne"));
        vm.expectRevert(PerplyArena.AdminOperationAlreadyQueued.selector);
        arena.setPriceSigner(makeAddr("signerTwo"));
    }

    function testDirectSettlementToggleIsTimelocked() public {
        arena.setDirectSettlementEnabled(true);
        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executeDirectSettlementToggle();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executeDirectSettlementToggle();
        assertTrue(arena.directSettlementEnabled(), "direct settlement must be enabled after timelock");
    }

    function testDirectSettlementToggleCannotOverwritePendingQueue() public {
        arena.setDirectSettlementEnabled(true);
        vm.expectRevert(PerplyArena.AdminOperationAlreadyQueued.selector);
        arena.setDirectSettlementEnabled(false);
    }

    function testMaxPriceAgeUpdateIsTimelocked() public {
        arena.setMaxPriceAgeSec(120);

        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executeMaxPriceAgeSecUpdate();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executeMaxPriceAgeSecUpdate();
        assertEq(arena.maxPriceAgeSec(), 120, "max price age update should execute after timelock");
    }

    function testMaxPriceAgeCannotOverwritePendingQueue() public {
        arena.setMaxPriceAgeSec(120);
        vm.expectRevert(PerplyArena.AdminOperationAlreadyQueued.selector);
        arena.setMaxPriceAgeSec(180);
    }

    function testTreasuryWithdrawalIsTimelocked() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        uint256 amount = 0.001 ether;
        uint256 before = alice.balance;
        arena.withdrawTreasury(payable(alice), amount);

        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executeTreasuryWithdrawal();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executeTreasuryWithdrawal();
        assertEq(alice.balance, before + amount, "treasury withdrawal should execute after timelock");
    }

    function testTreasuryWithdrawalCannotOverwritePendingQueue() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 10);

        arena.withdrawTreasury(payable(alice), 0.001 ether);
        vm.expectRevert(PerplyArena.AdminOperationAlreadyQueued.selector);
        arena.withdrawTreasury(payable(bob), 0.001 ether);
    }

    function testInsuranceWithdrawalIsTimelocked() public {
        vm.prank(alice);
        arena.donateInsurance{value: 1 ether}();

        uint256 amount = 0.2 ether;
        uint256 before = alice.balance;
        arena.withdrawInsurance(payable(alice), amount);

        vm.expectRevert(PerplyArena.AdminOperationTimelockPending.selector);
        arena.executeInsuranceWithdrawal();

        vm.warp(block.timestamp + arena.adminOpsTimelockSec());
        arena.executeInsuranceWithdrawal();
        assertEq(alice.balance, before + amount, "insurance withdrawal should execute after timelock");
    }

    function testInsuranceWithdrawalCannotOverwritePendingQueue() public {
        vm.prank(alice);
        arena.donateInsurance{value: 1 ether}();

        arena.withdrawInsurance(payable(alice), 0.2 ether);
        vm.expectRevert(PerplyArena.AdminOperationAlreadyQueued.selector);
        arena.withdrawInsurance(payable(bob), 0.1 ether);
    }

    function testBadDebtIsTrackedAndBlocksNewOpenUntilRecapitalized() public {
        _deposit(alice, 10 ether);
        _open(alice, LONG, 1 ether, 100);
        _deposit(bob, 10 ether);
        _open(bob, SHORT, 1 ether, 100);

        _advanceAndSettle(101e8);
        _advanceAndSettle(102e8);
        _advanceAndSettle(103e8);
        _advanceAndSettle(104e8);

        _close(bob, SHORT);
        assertGt(arena.systemBadDebt(), 0, "system bad debt must be recorded");
        vm.expectRevert(PerplyArena.SystemInsolvent.selector);
        arena.withdrawTreasury(payable(address(this)), 1);

        _deposit(carol, 10 ether);
        vm.prank(carol);
        vm.expectRevert(PerplyArena.SystemInsolvent.selector);
        arena.openPosition(LONG, 1 ether, 5);

        vm.prank(alice);
        arena.donateInsurance{value: arena.systemBadDebt()}();
        assertEq(arena.systemBadDebt(), 0, "bad debt should be repaid");

        vm.prank(carol);
        arena.openPosition(LONG, 1 ether, 5);
        assertTrue(arena.getPosition(carol, LONG).isOpen, "open should resume after recapitalization");
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

    function _settleSigned(uint256 newPrice) internal {
        uint64 timestamp = uint64(block.timestamp);
        uint64 salt = ++priceSalt;
        bytes memory sig = _signPrice(newPrice, timestamp, salt);
        arena.settleWithSignedPrice(newPrice, timestamp, salt, sig);
    }

    function _advanceAndSettle(uint256 newPrice) internal {
        vm.warp(block.timestamp + arena.minSettlementInterval());
        _settleSigned(newPrice);
    }

    function _signPrice(uint256 newPrice, uint64 timestamp, uint64 salt) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked(address(arena), block.chainid, newPrice, timestamp, salt));
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethDigest);
        return abi.encodePacked(r, s, v);
    }

    function _toInt256Safe(uint256 value) internal pure returns (int256) {
        if (value > uint256(type(int256).max)) revert("int256 overflow in test");
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(value);
    }
}
